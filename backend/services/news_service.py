import logging
from datetime import datetime, timedelta
import requests

logger = logging.getLogger(__name__)

class NewsService:
    @staticmethod
    def fetch_news(ticker: str = "", page: int = 1, page_size: int = 12) -> list:
        """
        Fetch news from VCI AI. If ticker is empty, it fetches general market news.
        Returns a formatted list of dictionaries.
        """
        end_date = datetime.now()
        start_date = end_date - timedelta(days=365) # Fetch up to 1 year back
        
        url = f"https://ai.vietcap.com.vn/api/v3/news_info?page={page}&ticker={ticker}&industry=&update_from={start_date.strftime('%Y-%m-%d')}&update_to={end_date.strftime('%Y-%m-%d')}&sentiment=&newsfrom=&language=vi&page_size={page_size}"
        headers = {
            'Accept': 'application/json, text/plain, */*',
            'Origin': 'https://trading.vietcap.com.vn',
            'Referer': 'https://trading.vietcap.com.vn/',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
        
        try:
            r = requests.get(url, headers=headers, timeout=5, verify=False)
            r.raise_for_status()
            data = r.json()
            
            news_data = []
            for item in data.get('news_info', []):
                news_data.append({
                    "Title": item.get('news_title', ''),
                    "Link": item.get('news_source_link', '#'),
                    "NewsUrl": item.get('news_source_link', '#'),
                    "Source": item.get('news_from_name', ''),
                    "PublishDate": item.get('update_date', ''),
                    "ImageThumb": item.get('news_image_url', ''),
                    "Avatar": item.get('news_image_url', ''),
                    "Sentiment": item.get('sentiment', ''),
                    "Score": item.get('score', 0),
                    "Symbol": item.get('ticker', ''),
                    
                    # Also keep lowercased fields mapping to the new UI structure
                    "title": item.get('news_title', ''),
                    "url": item.get('news_source_link', '#'),
                    "source": item.get('news_from_name', ''),
                    "publish_date": item.get('update_date', ''),
                    "image_url": item.get('news_image_url', ''),
                    "sentiment": item.get('sentiment', ''),
                    "score": item.get('score', 0),
                    "female_audio_duration": item.get('female_audio_duration', 0),
                    "male_audio_duration": item.get('male_audio_duration', 0)
                })
                
            return news_data
        except Exception as e:
            logger.error(f"Error fetching VCI AI news (ticker={ticker}): {e}")
            return []
