# Vietnam Stock Valuation Tool

A comprehensive web application for valuing Vietnamese stocks using multiple financial models including FCFE, FCFF, Justified P/E, and Justified P/B ratios.

## 🚀 Live Demo

Visit the live application: [https://valuation-fawn.vercel.app]

## 📋 Features

- **Real-time Stock Data**: Fetches live data from Vietnamese stock market
- **Multiple Valuation Models**: 
  - Free Cash Flow to Equity (FCFE)
  - Free Cash Flow to Firm (FCFF) 
  - Justified P/E Ratio
  - Justified P/B Ratio
- **Interactive Charts**: Historical trends and financial ratios visualization
- **Investment Recommendations**: Buy/Hold/Sell recommendations based on 15% threshold
- **Responsive Design**: Works on desktop, tablet, and mobile devices
- **Dark/Light Theme**: Toggle between themes
- **PDF Export**: Generate valuation reports

## 🛠️ Technologies Used

- **Frontend**: HTML5, CSS3, JavaScript (ES6+)
- **Backend**: Python Flask
- **Charts**: Chart.js
- **Data Source**: vnstock API
- **Styling**: Custom CSS with CSS Variables

## 📦 Installation & Setup

### Prerequisites
- Python 3.8+
- pip (Python package manager)

### Backend Setup
1. Clone the repository:
```bash
git clone https://github.com/yourusername/vietnam-stock-valuation.git
cd vietnam-stock-valuation
```

2. Install Python dependencies:
```bash
pip install flask flask-cors vnstock pandas numpy requests
```

3. Run the backend server:
```bash
python backend_server.py
```

The server will start on `http://localhost:5000`

### Frontend Setup
1. Open `index.html` in a web browser, or
2. Use a local server like Live Server extension in VS Code

## 🌐 Deployment Options

### GitHub Pages (Static Frontend Only)
1. Push your code to a GitHub repository
2. Go to repository Settings > Pages
3. Select source branch (usually `main`)
4. Your site will be available at `https://yourusername.github.io/repository-name`

### Vercel (Recommended for Full Stack)
1. Connect your GitHub repository to Vercel
2. Configure build settings for Python backend
3. Deploy with automatic SSL and CDN

### Heroku (Full Stack)
1. Add `requirements.txt` and `Procfile`
2. Deploy via Heroku CLI or GitHub integration

## 📊 API Endpoints

- `GET /api/stock/<symbol>` - Get stock information
- `POST /api/valuation` - Calculate stock valuation
- `GET /api/historical/<symbol>` - Get historical chart data

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 👨‍💻 Author

Created by quanganhdeptrai

## ⚠️ Disclaimer

This tool is for educational and informational purposes only. It should not be considered as financial advice. Always do your own research and consult with financial professionals before making investment decisions.
