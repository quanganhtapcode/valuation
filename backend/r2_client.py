"""
Cloudflare R2 Client for Excel file storage
Uses S3-compatible API via boto3
"""
import os
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError, NoCredentialsError
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

class R2Client:
    """
    Cloudflare R2 Storage Client
    Provides secure file upload/download with pre-signed URLs
    """
    
    def __init__(self):
        """Initialize R2 client with credentials from environment variables"""
        self.account_id = os.getenv('R2_ACCOUNT_ID')
        self.access_key_id = os.getenv('R2_ACCESS_KEY_ID')
        self.secret_access_key = os.getenv('R2_SECRET_ACCESS_KEY')
        self.bucket_name = os.getenv('R2_BUCKET_NAME', 'data')
        self.endpoint_url = os.getenv('R2_ENDPOINT_URL')
        self.excel_folder = os.getenv('R2_EXCEL_FOLDER', 'excel')
        
        # Validate credentials
        if not all([self.account_id, self.access_key_id, self.secret_access_key]):
            logger.warning("R2 credentials not configured. File operations will fail.")
            self._client = None
            return
        
        # Create S3 client configured for R2
        try:
            self._client = boto3.client(
                's3',
                endpoint_url=self.endpoint_url,
                aws_access_key_id=self.access_key_id,
                aws_secret_access_key=self.secret_access_key,
                config=Config(
                    signature_version='s3v4',
                    retries={'max_attempts': 3, 'mode': 'adaptive'}
                ),
                region_name='auto'  # R2 uses 'auto' region
            )
            logger.info(f"R2 client initialized successfully for bucket: {self.bucket_name}")
        except Exception as e:
            logger.error(f"Failed to initialize R2 client: {e}")
            self._client = None
    
    @property
    def is_configured(self) -> bool:
        """Check if R2 client is properly configured"""
        return self._client is not None
    
    def _get_excel_key(self, symbol: str) -> str:
        """Generate the R2 object key for an Excel file"""
        return f"{self.excel_folder}/{symbol.upper()}.xlsx"
    
    def upload_excel(self, symbol: str, file_content: bytes) -> dict:
        """
        Upload Excel file to R2
        
        Args:
            symbol: Stock symbol (e.g., 'VCB', 'FPT')
            file_content: Binary content of the Excel file
        
        Returns:
            dict with 'success', 'key', and optional 'error'
        """
        if not self.is_configured:
            return {'success': False, 'error': 'R2 client not configured'}
        
        key = self._get_excel_key(symbol)
        
        try:
            self._client.put_object(
                Bucket=self.bucket_name,
                Key=key,
                Body=file_content,
                ContentType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                Metadata={
                    'symbol': symbol.upper(),
                    'uploaded_at': datetime.utcnow().isoformat()
                }
            )
            logger.info(f"✓ Uploaded {symbol}.xlsx to R2 ({len(file_content)} bytes)")
            return {'success': True, 'key': key}
        
        except ClientError as e:
            error_code = e.response['Error']['Code']
            error_msg = e.response['Error']['Message']
            logger.error(f"✗ Failed to upload {symbol}.xlsx: {error_code} - {error_msg}")
            return {'success': False, 'error': f"{error_code}: {error_msg}"}
        
        except Exception as e:
            logger.error(f"✗ Unexpected error uploading {symbol}.xlsx: {e}")
            return {'success': False, 'error': str(e)}
    
    def download_excel(self, symbol: str) -> dict:
        """
        Download Excel file from R2
        
        Args:
            symbol: Stock symbol
        
        Returns:
            dict with 'success', 'content' (bytes), 'size', and optional 'error'
        """
        if not self.is_configured:
            return {'success': False, 'error': 'R2 client not configured'}
        
        key = self._get_excel_key(symbol)
        
        try:
            response = self._client.get_object(
                Bucket=self.bucket_name,
                Key=key
            )
            content = response['Body'].read()
            logger.info(f"✓ Downloaded {symbol}.xlsx from R2 ({len(content)} bytes)")
            return {
                'success': True,
                'content': content,
                'size': len(content),
                'content_type': response.get('ContentType', 'application/octet-stream')
            }
        
        except ClientError as e:
            error_code = e.response['Error']['Code']
            if error_code == 'NoSuchKey':
                logger.warning(f"File not found in R2: {symbol}.xlsx")
                return {'success': False, 'error': 'File not found', 'not_found': True}
            logger.error(f"✗ Failed to download {symbol}.xlsx: {error_code}")
            return {'success': False, 'error': error_code}
        
        except Exception as e:
            logger.error(f"✗ Unexpected error downloading {symbol}.xlsx: {e}")
            return {'success': False, 'error': str(e)}
    
    def get_presigned_url(self, symbol: str, expires_in: int = 900) -> dict:
        """
        Generate a pre-signed URL for secure download
        
        Args:
            symbol: Stock symbol
            expires_in: URL expiration time in seconds (default: 15 minutes)
        
        Returns:
            dict with 'success', 'url', 'expires_in', and optional 'error'
        """
        if not self.is_configured:
            return {'success': False, 'error': 'R2 client not configured'}
        
        key = self._get_excel_key(symbol)
        
        try:
            # First check if file exists
            self._client.head_object(Bucket=self.bucket_name, Key=key)
            
            # Generate pre-signed URL
            url = self._client.generate_presigned_url(
                'get_object',
                Params={
                    'Bucket': self.bucket_name,
                    'Key': key,
                    'ResponseContentDisposition': f'attachment; filename="{symbol.upper()}.xlsx"'
                },
                ExpiresIn=expires_in
            )
            
            logger.info(f"Generated pre-signed URL for {symbol}.xlsx (expires in {expires_in}s)")
            return {
                'success': True,
                'url': url,
                'expires_in': expires_in,
                'filename': f'{symbol.upper()}.xlsx'
            }
        
        except ClientError as e:
            error_code = e.response['Error']['Code']
            if error_code in ['NoSuchKey', '404']:
                return {'success': False, 'error': 'File not found', 'not_found': True}
            logger.error(f"✗ Failed to generate URL for {symbol}.xlsx: {error_code}")
            return {'success': False, 'error': error_code}
        
        except Exception as e:
            logger.error(f"✗ Unexpected error generating URL: {e}")
            return {'success': False, 'error': str(e)}
    
    def file_exists(self, symbol: str) -> bool:
        """Check if an Excel file exists in R2"""
        if not self.is_configured:
            return False
        
        key = self._get_excel_key(symbol)
        
        try:
            self._client.head_object(Bucket=self.bucket_name, Key=key)
            return True
        except ClientError:
            return False
    
    def list_excel_files(self, max_files: int = 5000) -> dict:
        """
        List all Excel files in the bucket using pagination
        
        Returns:
            dict with 'success', 'files' (list of symbol names), 'count'
        """
        if not self.is_configured:
            return {'success': False, 'error': 'R2 client not configured'}
        
        try:
            files = []
            continuation_token = None
            
            while len(files) < max_files:
                list_args = {
                    'Bucket': self.bucket_name,
                    'Prefix': f"{self.excel_folder}/",
                    'MaxKeys': min(1000, max_files - len(files))
                }
                if continuation_token:
                    list_args['ContinuationToken'] = continuation_token
                
                response = self._client.list_objects_v2(**list_args)
                
                for obj in response.get('Contents', []):
                    key = obj['Key']
                    if key.endswith('.xlsx'):
                        symbol = key.replace(f"{self.excel_folder}/", '').replace('.xlsx', '')
                        files.append({
                            'symbol': symbol,
                            'size': obj['Size'],
                            'last_modified': obj['LastModified'].isoformat()
                        })
                
                if not response.get('IsTruncated'):
                    break
                continuation_token = response.get('NextContinuationToken')
            
            return {
                'success': True,
                'files': files,
                'count': len(files)
            }
        
        except Exception as e:
            logger.error(f"Failed to list files: {e}")
            return {'success': False, 'error': str(e)}
    
    def delete_excel(self, symbol: str) -> dict:
        """Delete an Excel file from R2"""
        if not self.is_configured:
            return {'success': False, 'error': 'R2 client not configured'}
        
        key = self._get_excel_key(symbol)
        
        try:
            self._client.delete_object(Bucket=self.bucket_name, Key=key)
            logger.info(f"✓ Deleted {symbol}.xlsx from R2")
            return {'success': True}
        except Exception as e:
            logger.error(f"✗ Failed to delete {symbol}.xlsx: {e}")
            return {'success': False, 'error': str(e)}


# Global instance (lazy initialization)
_r2_client = None

def get_r2_client() -> R2Client:
    """Get or create the global R2 client instance"""
    global _r2_client
    if _r2_client is None:
        _r2_client = R2Client()
    return _r2_client
