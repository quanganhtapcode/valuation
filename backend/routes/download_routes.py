from flask import Blueprint, jsonify, request, redirect, send_file
import logging
import os
import time
import io
from collections import defaultdict
from functools import wraps
from datetime import datetime
from backend.utils import get_client_ip, validate_stock_symbol
from backend.r2_client import get_r2_client
from backend.extensions import get_provider

download_bp = Blueprint('download', __name__)
logger = logging.getLogger(__name__)

# Download rate limiting - track downloads per IP
download_tracker = defaultdict(list)
DOWNLOAD_LIMIT = 20  # Max downloads per IP per window
DOWNLOAD_WINDOW = 3600  # 1 hour window (in seconds)

def rate_limit_download(f):
    """Decorator to implement rate limiting for downloads"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # Use centralized IP detection
        client_ip = get_client_ip()
        
        current_time = time.time()
        
        # Clean up old download records (outside the time window)
        download_tracker[client_ip] = [
            timestamp for timestamp in download_tracker[client_ip]
            if current_time - timestamp < DOWNLOAD_WINDOW
        ]
        
        # Check if IP has exceeded the limit
        if len(download_tracker[client_ip]) >= DOWNLOAD_LIMIT:
            oldest_download = download_tracker[client_ip][0]
            time_until_reset = DOWNLOAD_WINDOW - (current_time - oldest_download)
            
            logger.warning(f"Rate limit exceeded for IP {client_ip}: {len(download_tracker[client_ip])} downloads in window")
            
            return jsonify({
                'error': 'Rate limit exceeded',
                'message': f'You have exceeded the download limit of {DOWNLOAD_LIMIT} files per hour. Please try again later.',
                'retry_after': int(time_until_reset),
                'retry_after_minutes': round(time_until_reset / 60, 1)
            }), 429  # 429 Too Many Requests
        
        # Record this download
        download_tracker[client_ip].append(current_time)
        
        logger.info(f"Download request from IP {client_ip}: {len(download_tracker[client_ip])}/{DOWNLOAD_LIMIT} in current window")
        
        return f(*args, **kwargs)
    return decorated_function

@download_bp.route("/api/stock/excel/<symbol>")
def api_stock_excel_url(symbol):
    """Returns the download URL for a stock's Excel file (JSON response for frontend)"""
    try:
        # Validate symbol
        is_valid, clean_symbol = validate_stock_symbol(symbol)
        if not is_valid:
            return jsonify({"success": False, "error": "Invalid symbol"}), 400
            
        # 1. Try R2 First for optimized direct download
        r2_client = get_r2_client()
        if r2_client.is_configured:
            # Generate 15-minute presigned URL
            presigned_result = r2_client.get_presigned_url(clean_symbol, expires_in=900)
            
            if presigned_result.get('success'):
                # Return the Cloudflare CDN url directly!
                return jsonify({
                    "success": True,
                    "url": presigned_result['url']
                })
            elif presigned_result.get('not_found'):
                return jsonify({
                    "success": False, 
                    "error": f"Không tìm thấy file dữ liệu Excel cho {clean_symbol}"
                }), 404
        
        # 2. Fallback (If R2 is down or not configured)
        return jsonify({
            "success": True,
            "url": f"/api/download/{clean_symbol}"
        })
    except Exception as exc:
        logger.error(f"API /stock/excel error {symbol}: {exc}")
        return jsonify({"success": False, "error": str(exc)}), 500

@download_bp.route('/api/download/<ticker>')
@rate_limit_download
def download_financial_data(ticker):
    """Download financial statement Excel file for a specific ticker
    
    Storage: Cloudflare R2 (with local fallback)
    Security: Pre-signed URLs with 15-minute expiration
    
    Rate limits:
    - Maximum 20 downloads per IP per hour
    - Returns 429 status code when limit exceeded
    - CORS restricted to official domains
    """
    try:
        # Use centralized validation
        is_valid, result = validate_stock_symbol(ticker)
        if not is_valid:
            logger.warning(f"Invalid ticker from {get_client_ip()}: {ticker} - {result}")
            return jsonify({
                'error': 'Invalid ticker',
                'message': result
            }), 400
        
        # Use validated/sanitized ticker
        ticker = result
        client_ip = get_client_ip()
        proxy_mode = request.args.get('proxy', '').strip().lower() in {'1', 'true', 'yes'}
        
        # Try R2 first (primary storage)
        r2_client = get_r2_client()
        if r2_client.is_configured:
            if proxy_mode:
                # Same-origin proxy mode for browser fetch/XHR (avoids R2 CORS issues)
                dl = r2_client.download_excel(ticker)
                if dl.get('success') and dl.get('content'):
                    logger.info(f"R2 proxy download for {ticker} to {client_ip}")
                    return send_file(
                        io.BytesIO(dl['content']),
                        as_attachment=True,
                        download_name=f'{ticker}.xlsx',
                        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                    )
                if not dl.get('not_found'):
                    logger.warning(f"R2 proxy download failed for {ticker}: {dl.get('error')}")

            # Redirect to pre-signed URL (user downloads directly from R2 CDN)
            # CORS is configured on R2 bucket to allow valuation.quanganh.org
            presigned_result = r2_client.get_presigned_url(ticker, expires_in=60)  # 15 minutes
            
            if presigned_result['success']:
                logger.info(f"R2 redirect for {ticker} to {client_ip}")
                return redirect(presigned_result['url'], code=302)
            elif presigned_result.get('not_found'):
                # File not in R2, try local fallback
                pass
            else:
                # R2 error, log and try local fallback
                logger.warning(f"R2 presigned URL failed for {ticker}: {presigned_result.get('error')}")
        
        # Fallback: Local file system (for backwards compatibility)
        # Note: We assume 'data/' is relative to the project root, which is one level up from 'backend/'
        # but 'backend/routes/' is two levels down.
        # Adjusted path logic:
        # __file__ is in backend/routes/download_routes.py
        # os.path.dirname(__file__) -> backend/routes
        # os.path.dirname(...) -> backend
        # os.path.dirname(...) -> root
        # root/data -> data folder
        script_dir = os.path.dirname(os.path.abspath(__file__))
        data_folder = os.path.join(os.path.dirname(os.path.dirname(script_dir)), 'data')
        file_path = os.path.join(data_folder, f'{ticker}.xlsx')
        
        if os.path.exists(file_path):
            file_size = os.path.getsize(file_path)
            logger.info(f"Local fallback for {ticker} ({file_size} bytes) to {client_ip}")
            return send_file(
                file_path,
                as_attachment=True,
                download_name=f'{ticker}.xlsx',
                mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            )
        
        # File not found in R2 or local
        logger.warning(f"Financial data not found for {ticker} (R2 and local)")
        return jsonify({
            'error': 'File not found',
            'message': f'Financial data for {ticker} is not available. The ticker may not exist or data has not been collected yet.',
            'ticker': ticker
        }), 404
        
    except Exception as e:
        logger.error(f"Error serving file for {ticker}: {e}")
        return jsonify({
            'error': 'Server error',
            'message': f'An error occurred while processing your download: {str(e)}',
            'ticker': ticker
        }), 500

@download_bp.route("/api/stats/downloads")
def get_download_stats():
    """Get download stats (admin only ideally, but public for now)"""
    try:
        # Check simple auth via header if needed, for now open
        stats = {
            "total_active_ips": len(download_tracker),
            "window_seconds": DOWNLOAD_WINDOW,
            "limit": DOWNLOAD_LIMIT,
            "active_ips": []
        }
        
        current_time = time.time()
        
        # Get stats for each IP
        for ip, timestamps in download_tracker.items():
            # Clean up old records
            active_downloads = [ts for ts in timestamps if current_time - ts < DOWNLOAD_WINDOW]
            
            if active_downloads:  # Only show IPs with recent activity
                stats["active_ips"].append({
                    "ip": ip,
                    "downloads_in_window": len(active_downloads),
                    "remaining": max(0, DOWNLOAD_LIMIT - len(active_downloads)),
                    "is_rate_limited": len(active_downloads) >= DOWNLOAD_LIMIT,
                    "last_download": datetime.fromtimestamp(active_downloads[-1]).strftime("%Y-%m-%d %H:%M:%S") if active_downloads else None
                })
        
        # Sort by most active
        stats["active_ips"].sort(key=lambda x: x["downloads_in_window"], reverse=True)
        
        return jsonify({
            "success": True,
            "stats": stats
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500
