/**
 * Vietnamese Stock Valuation - Client-side application logic
 * Uses vanilla JavaScript for state management and DOM manipulation
 * Integrates with Chart.js for historical trend visualization
 * Generates PDF reports using jsPDF
 */

// Application State
class StockValuationApp {
    constructor() {
        this.currentStock = null;
        this.stockData = null;
        this.historicalData = null;
        this.assumptions = {
            revenueGrowth: 8.0,
            terminalGrowth: 3.0,
            wacc: 10.5,
            requiredReturn: 12.0,
            taxRate: 20.0,
            projectionYears: 5
        };
        this.modelWeights = {
            fcfe: 25,
            fcff: 25,
            justified_pe: 25,
            justified_pb: 25
        };
        this.valuationResults = null;
        this.apiBaseUrl = 'http://localhost:5000';
        this.charts = {
            roeRoa: null,
            liquidity: null
        };

        this.init();
    }

    init() {
        this.setupEventListeners();
        this.loadDefaultAssumptions();
        this.setupThemeToggle();
        this.setupCharts();
    }

    setupEventListeners() {
        // Tab navigation
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.switchTab(e.target.dataset.tab));
        });

        // Stock search
        document.getElementById('load-data-btn').addEventListener('click', () => this.loadStockData());
        document.getElementById('stock-symbol').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.loadStockData();
        });

        // Assumptions form
        document.getElementById('calculate-btn').addEventListener('click', () => this.calculateValuation());
        document.getElementById('reset-assumptions-btn').addEventListener('click', () => this.resetAssumptions());

        // Real-time updates on assumption changes
        document.querySelectorAll('#assumptions-form input').forEach(input => {
            input.addEventListener('input', () => this.updateAssumptions());
        });

        // Model weights sliders
        document.getElementById('fcfe-weight').addEventListener('input', (e) => this.updateModelWeights(e));
        document.getElementById('fcff-weight').addEventListener('input', (e) => this.updateModelWeights(e));
        document.getElementById('pe-weight').addEventListener('input', (e) => this.updateModelWeights(e));
        document.getElementById('pb-weight').addEventListener('input', (e) => this.updateModelWeights(e));
        document.getElementById('normalize-weights-btn').addEventListener('click', () => this.normalizeWeights());

        // Export functionality
        document.getElementById('export-report-btn').addEventListener('click', () => this.exportReport());
    }    setupThemeToggle() {
        const themeToggle = document.getElementById('theme-toggle-btn');
        const currentTheme = localStorage.getItem('theme') || 'light';
        document.documentElement.setAttribute('data-theme', currentTheme);

        themeToggle.addEventListener('click', () => {
            const current = document.documentElement.getAttribute('data-theme');
            const newTheme = current === 'light' ? 'dark' : 'light';
            document.documentElement.setAttribute('data-theme', newTheme);
            localStorage.setItem('theme', newTheme);
        });
    }    setupCharts() {
        // Initialize ROE/ROA Chart with area/mountain style
        const roeRoaCtx = document.getElementById('roe-roa-chart').getContext('2d');
        this.charts.roeRoa = new Chart(roeRoaCtx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    {
                        label: 'ROA (%)',
                        data: [],
                        backgroundColor: 'rgba(75, 192, 192, 0.3)',
                        borderColor: 'rgba(75, 192, 192, 1)',
                        borderWidth: 3,
                        fill: 'origin',
                        tension: 0.4,                        pointBackgroundColor: 'rgba(75, 192, 192, 1)',
                        pointBorderColor: '#fff',
                        pointBorderWidth: 1,
                        pointRadius: 3,
                        pointHoverRadius: 5
                    },
                    {
                        label: 'ROE (%)',
                        data: [],
                        backgroundColor: 'rgba(54, 162, 235, 0.3)',
                        borderColor: 'rgba(54, 162, 235, 1)',
                        borderWidth: 3,
                        fill: 'origin',
                        tension: 0.4,
                        pointBackgroundColor: 'rgba(54, 162, 235, 1)',
                        pointBorderColor: '#fff',
                        pointBorderWidth: 1,
                        pointRadius: 3,
                        pointHoverRadius: 5
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    intersect: false,
                    mode: 'index'
                },
                scales: {
                    x: { 
                        grid: { display: false },
                        ticks: { maxTicksLimit: 5 }
                    },                    y: { 
                        beginAtZero: true,
                        title: { display: false },
                        grid: { color: 'rgba(0,0,0,0.1)' },
                        ticks: { maxTicksLimit: 6 }
                    }
                },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { usePointStyle: true, padding: 20 }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(0,0,0,0.8)',
                        titleColor: '#fff',
                        bodyColor: '#fff',
                        cornerRadius: 8,
                        displayColors: true
                    }
                },
                elements: {
                    point: { hoverBorderWidth: 3 }
                }
            }
        });        // Initialize Liquidity Chart
        const liquidityCtx = document.getElementById('liquidity-chart').getContext('2d');
        this.charts.liquidity = new Chart(liquidityCtx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    {
                        label: 'Current Ratio',
                        data: [],
                        borderColor: 'rgba(75, 192, 192, 1)',
                        backgroundColor: 'rgba(75, 192, 192, 0.1)',
                        borderWidth: 3,
                        fill: false,
                        tension: 0.3,                        pointBackgroundColor: 'rgba(75, 192, 192, 1)',
                        pointBorderColor: '#fff',
                        pointBorderWidth: 1,
                        pointRadius: 3,
                        pointHoverRadius: 5
                    },
                    {
                        label: 'Quick Ratio',
                        data: [],
                        borderColor: 'rgba(54, 162, 235, 1)',
                        backgroundColor: 'rgba(54, 162, 235, 0.1)',
                        borderWidth: 3,
                        fill: false,
                        tension: 0.3,
                        pointBackgroundColor: 'rgba(54, 162, 235, 1)',
                        pointBorderColor: '#fff',
                        pointBorderWidth: 1,
                        pointRadius: 3,
                        pointHoverRadius: 5
                    },
                    {
                        label: 'Cash Ratio',
                        data: [],
                        borderColor: 'rgba(255, 99, 132, 1)',
                        backgroundColor: 'rgba(255, 99, 132, 0.1)',
                        borderWidth: 3,
                        fill: false,
                        tension: 0.3,
                        pointBackgroundColor: 'rgba(255, 99, 132, 1)',
                        pointBorderColor: '#fff',
                        pointBorderWidth: 1,
                        pointRadius: 3,
                        pointHoverRadius: 5
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    intersect: false,
                    mode: 'index'
                },
                scales: {
                    x: { 
                        grid: { display: false },
                        ticks: { maxTicksLimit: 5 }
                    },                    y: { 
                        beginAtZero: true,
                        title: { display: false },
                        grid: { color: 'rgba(0,0,0,0.1)' },
                        ticks: { maxTicksLimit: 6 }
                    }
                },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { usePointStyle: true, padding: 20 }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(0,0,0,0.8)',
                        titleColor: '#fff',
                        bodyColor: '#fff',
                        cornerRadius: 8,
                        displayColors: true
                    }
                },
                elements: {
                    point: { hoverBorderWidth: 3 }
                }
            }
        });
    }

    switchTab(tabName) {
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

        document.querySelectorAll('.tab-pane').forEach(pane => {
            pane.classList.remove('active');
        });
        document.getElementById(tabName).classList.add('active');
    }

    loadDefaultAssumptions() {
        document.getElementById('revenue-growth').value = this.assumptions.revenueGrowth;
        document.getElementById('terminal-growth').value = this.assumptions.terminalGrowth;
        document.getElementById('wacc').value = this.assumptions.wacc;
        document.getElementById('required-return').value = this.assumptions.requiredReturn;
        document.getElementById('tax-rate').value = this.assumptions.taxRate;
        document.getElementById('projection-years').value = this.assumptions.projectionYears;

        this.updateWeightDisplay();
        this.updateTotalWeight();
    }

    updateAssumptions() {
        this.assumptions.revenueGrowth = parseFloat(document.getElementById('revenue-growth').value);
        this.assumptions.terminalGrowth = parseFloat(document.getElementById('terminal-growth').value);
        this.assumptions.wacc = parseFloat(document.getElementById('wacc').value);
        this.assumptions.requiredReturn = parseFloat(document.getElementById('required-return').value);
        this.assumptions.taxRate = parseFloat(document.getElementById('tax-rate').value);
        this.assumptions.projectionYears = parseInt(document.getElementById('projection-years').value);
    }

    updateModelWeights(event) {
        const sliderId = event.target.id;
        const value = parseFloat(event.target.value);

        switch(sliderId) {
            case 'fcfe-weight':
                this.modelWeights.fcfe = value;
                break;
            case 'fcff-weight':
                this.modelWeights.fcff = value;
                break;
            case 'pe-weight':
                this.modelWeights.justified_pe = value;
                break;
            case 'pb-weight':
                this.modelWeights.justified_pb = value;
                break;
        }

        this.updateWeightDisplay();
        this.updateTotalWeight();

        if (this.valuationResults) {
            this.updateWeightedResults();
            this.updateRecommendation();
        }
    }

    updateWeightDisplay() {
        document.getElementById('fcfe-weight-value').textContent = `${this.modelWeights.fcfe.toFixed(1)}%`;
        document.getElementById('fcff-weight-value').textContent = `${this.modelWeights.fcff.toFixed(1)}%`;
        document.getElementById('pe-weight-value').textContent = `${this.modelWeights.justified_pe.toFixed(1)}%`;
        document.getElementById('pb-weight-value').textContent = `${this.modelWeights.justified_pb.toFixed(1)}%`;
    }

    updateTotalWeight() {
        const total = this.modelWeights.fcfe + this.modelWeights.fcff + 
                     this.modelWeights.justified_pe + this.modelWeights.justified_pb;
        const totalElement = document.getElementById('total-weight');
        totalElement.textContent = total.toFixed(1);

        if (Math.abs(total - 100) < 0.1) {
            totalElement.className = 'weight-total-correct';
        } else {
            totalElement.className = 'weight-total-incorrect';
        }
    }

    normalizeWeights() {
        this.modelWeights.fcfe = 25.0;
        this.modelWeights.fcff = 25.0;
        this.modelWeights.justified_pe = 25.0;
        this.modelWeights.justified_pb = 25.0;

        document.getElementById('fcfe-weight').value = 25.0;
        document.getElementById('fcff-weight').value = 25.0;
        document.getElementById('pe-weight').value = 25.0;
        document.getElementById('pb-weight').value = 25.0;

        this.updateWeightDisplay();
        this.updateTotalWeight();

        if (this.valuationResults) {
            this.updateWeightedResults();
            this.updateRecommendation();
        }
    }

    resetAssumptions() {
        this.assumptions = {
            revenueGrowth: 8.0,
            terminalGrowth: 3.0,
            wacc: 10.5,
            requiredReturn: 12.0,
            taxRate: 20.0,
            projectionYears: 5
        };

        this.loadDefaultAssumptions();
    }    async loadStockData() {
        const symbol = document.getElementById('stock-symbol').value.trim().toUpperCase();
        const period = 'year'; // Default to year data

        if (!symbol) {
            this.showStatus('Please enter a stock symbol', 'error');
            return;
        }

        this.showLoading(true);
        this.showStatus('Loading data...', 'info');

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);

            // Fetch stock data
            const stockResponse = await fetch(`${this.apiBaseUrl}/api/app-data/${symbol}?period=${period}`, {
                signal: controller.signal
            });

            // Fetch historical chart data
            const chartResponse = await fetch(`${this.apiBaseUrl}/api/historical-chart-data/${symbol}`, {
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!stockResponse.ok) {
                if (stockResponse.status === 404) {
                    throw new Error('No data found for this stock symbol');
                } else if (stockResponse.status === 500) {
                    throw new Error('Server error while loading data');
                } else {
                    throw new Error('Unable to connect to server');
                }
            }

            if (!chartResponse.ok) {
                console.warn('Failed to load historical chart data');
            }

            const stockData = await stockResponse.json();
            const chartData = chartResponse.ok ? await chartResponse.json() : { success: false, data: {} };

            if (!stockData.success) {
                throw new Error(stockData.error || 'Unable to load data from server');
            }

            this.stockData = stockData;
            this.currentStock = symbol;
            this.historicalData = chartData.success ? chartData.data : null;

            this.updateOverviewDisplay(stockData);
            this.updateCharts();
            this.showStatus('Data loaded successfully', 'success');

        } catch (error) {
            console.error('Error loading data:', error);

            if (error.name === 'AbortError') {
                this.showStatus('Timeout - Please try again later.', 'error');
            } else {
                this.showStatus(`Data loading error: ${error.message}`, 'error');
            }

            this.stockData = null;
            this.currentStock = null;
            this.historicalData = null;
            this.clearDisplay();
            this.clearCharts();

        } finally {
            this.showLoading(false);
        }
    }

    async calculateValuation() {
        if (!this.currentStock) {
            this.showStatus('Please load company data first', 'error');
            return;
        }

        try {
            this.showStatus('Calculating valuation models...', 'info');

            const requestData = {
                revenueGrowth: this.assumptions.revenueGrowth,
                terminalGrowth: this.assumptions.terminalGrowth,
                wacc: this.assumptions.wacc,
                requiredReturn: this.assumptions.requiredReturn,
                taxRate: this.assumptions.taxRate,
                projectionYears: this.assumptions.projectionYears,
                roe: 15.0,
                payoutRatio: 40.0,
                modelWeights: this.modelWeights
            };

            const response = await fetch(`${this.apiBaseUrl}/api/valuation/${this.currentStock}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestData)
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();

            if (!result.success) {
                throw new Error(result.error || 'Valuation calculation failed');
            }

            this.valuationResults = {
                fcfe: {
                    shareValue: result.valuations.fcfe,
                    equityValue: result.valuations.fcfe * (this.stockData.shares_outstanding || result.financial_data.shares_outstanding)
                },
                fcff: {
                    shareValue: result.valuations.fcff,
                    equityValue: result.valuations.fcff * (this.stockData.shares_outstanding || result.financial_data.shares_outstanding)
                },
                justified_pe: {
                    shareValue: result.valuations.justified_pe
                },
                justified_pb: {
                    shareValue: result.valuations.justified_pb
                },
                weighted_average: result.valuations.weighted_average,
                summary: result.summary,
                market_comparison: result.market_comparison,
                financial_data: result.financial_data
            };

            this.updateValuationDisplay();
            this.updateWeightedResults();
            this.updateRecommendation();

            document.getElementById('export-report-btn').disabled = false;

            this.showStatus('Valuation calculation completed', 'success');

        } catch (error) {
            console.error('Error calculating valuation:', error);
            this.showStatus(`Error calculating valuation: ${error.message}`, 'error');
        }
    }

    updateCharts() {
        if (!this.historicalData) {
            this.clearCharts();
            return;
        }

        // Update ROE/ROA Chart
        this.charts.roeRoa.data.labels = this.historicalData.years;
        this.charts.roeRoa.data.datasets[0].data = this.historicalData.roa_data;
        this.charts.roeRoa.data.datasets[1].data = this.historicalData.roe_data;
        this.charts.roeRoa.update();

        // Update Liquidity Chart
        this.charts.liquidity.data.labels = this.historicalData.years;
        this.charts.liquidity.data.datasets[0].data = this.historicalData.current_ratio_data;
        this.charts.liquidity.data.datasets[1].data = this.historicalData.quick_ratio_data;
        this.charts.liquidity.data.datasets[2].data = this.historicalData.cash_ratio_data;
        this.charts.liquidity.update();
    }

    clearCharts() {
        this.charts.roeRoa.data.labels = [];
        this.charts.roeRoa.data.datasets.forEach(dataset => dataset.data = []);
        this.charts.roeRoa.update();

        this.charts.liquidity.data.labels = [];
        this.charts.liquidity.data.datasets.forEach(dataset => dataset.data = []);
        this.charts.liquidity.update();
    }

    updateValuationDisplay() {
        const currentPrice = this.stockData.current_price;

        // FCFE Results
        document.getElementById('fcfe-result').textContent = this.formatCurrency(this.valuationResults.fcfe.shareValue);
        const fcfeDiff = ((this.valuationResults.fcfe.shareValue - currentPrice) / currentPrice) * 100;
        const fcfeDiffElement = document.getElementById('fcfe-diff');
        fcfeDiffElement.textContent = `${fcfeDiff > 0 ? '+' : ''}${fcfeDiff.toFixed(1)}%`;
        fcfeDiffElement.className = `result-diff ${fcfeDiff > 0 ? 'positive' : 'negative'}`;

        // FCFF Results
        document.getElementById('fcff-result').textContent = this.formatCurrency(this.valuationResults.fcff.shareValue);
        const fcffDiff = ((this.valuationResults.fcff.shareValue - currentPrice) / currentPrice) * 100;
        const fcffDiffElement = document.getElementById('fcff-diff');
        fcffDiffElement.textContent = `${fcffDiff > 0 ? '+' : ''}${fcffDiff.toFixed(1)}%`;
        fcffDiffElement.className = `result-diff ${fcffDiff > 0 ? 'positive' : 'negative'}`;

        // Justified P/E Results
        document.getElementById('pe-result').textContent = this.formatCurrency(this.valuationResults.justified_pe.shareValue);
        const peDiff = ((this.valuationResults.justified_pe.shareValue - currentPrice) / currentPrice) * 100;
        const peDiffElement = document.getElementById('pe-diff');
        peDiffElement.textContent = `${peDiff > 0 ? '+' : ''}${peDiff.toFixed(1)}%`;
        peDiffElement.className = `result-diff ${peDiff > 0 ? 'positive' : 'negative'}`;

        // Justified P/B Results
        document.getElementById('pb-result').textContent = this.formatCurrency(this.valuationResults.justified_pb.shareValue);
        const pbDiff = ((this.valuationResults.justified_pb.shareValue - currentPrice) / currentPrice) * 100;
        const pbDiffElement = document.getElementById('pb-diff');
        pbDiffElement.textContent = `${pbDiff > 0 ? '+' : ''}${pbDiff.toFixed(1)}%`;
        pbDiffElement.className = `result-diff ${pbDiff > 0 ? 'positive' : 'negative'}`;

        // Weighted Average Results
        const weightedValue = this.valuationResults.weighted_average;
        document.getElementById('weighted-result').textContent = this.formatCurrency(weightedValue);
        const weightedDiff = ((weightedValue - currentPrice) / currentPrice) * 100;
        const weightedDiffElement = document.getElementById('weighted-diff');
        weightedDiffElement.textContent = `${weightedDiff > 0 ? '+' : ''}${weightedDiff.toFixed(1)}%`;
        weightedDiffElement.className = `result-diff ${weightedDiff > 0 ? 'positive' : 'negative'}`;

        // Update summary
        this.safeUpdateElement('target-price', this.formatCurrency(weightedValue));
        this.safeUpdateElement('summary-potential', `${weightedDiff.toFixed(1)}%`);
        this.safeUpdateElement('return-value', `${weightedDiff.toFixed(1)}%`);

        // Update model details with PE/PB ratios
        this.updateModelDetails();
    }

    updateWeightedResults() {
        const weightedValue = this.valuationResults.weighted_average;
        const currentPrice = this.stockData.current_price;
        const weightedDiff = ((weightedValue - currentPrice) / currentPrice) * 100;

        document.getElementById('weighted-result').textContent = this.formatCurrency(weightedValue);
        const weightedDiffElement = document.getElementById('weighted-diff');
        weightedDiffElement.textContent = `${weightedDiff > 0 ? '+' : ''}${weightedDiff.toFixed(1)}%`;
        weightedDiffElement.className = `result-diff ${weightedDiff > 0 ? 'positive' : 'negative'}`;

        this.safeUpdateElement('target-price', this.formatCurrency(weightedValue));
        this.safeUpdateElement('summary-potential', `${weightedDiff.toFixed(1)}%`);
        this.safeUpdateElement('return-value', `${weightedDiff.toFixed(1)}%`);
    }

    updateRecommendation() {
        const weightedValue = this.valuationResults.weighted_average;
        const currentPrice = this.stockData.current_price;
        const upside = ((weightedValue - currentPrice) / currentPrice) * 100;

        let recommendation, status, reasoning;

        if (this.valuationResults.market_comparison) {
            recommendation = this.valuationResults.market_comparison.recommendation;
            reasoning = `Based on 4-model average of ${this.formatCurrency(weightedValue)} vs current price ${this.formatCurrency(currentPrice)}`;
            status = recommendation.includes('BUY') ? 'positive' : recommendation.includes('SELL') ? 'negative' : 'neutral';
        } else {
            if (upside > 15) {
                recommendation = 'BUY';
                status = 'positive';
                reasoning = 'Significant undervaluation detected - upside potential above 15%';
            } else if (upside < -15) {
                recommendation = 'SELL';
                status = 'negative';
                reasoning = 'Significant overvaluation detected - downside risk above 15%';
            } else {
                recommendation = 'HOLD';
                status = 'neutral';
                reasoning = 'Stock is fairly valued - upside/downside within 15% range';
            }
        }

        const recommendationElement = document.getElementById('recommendation');
        recommendationElement.innerHTML = `<span class="status status--${status}">${recommendation}</span>`;

        const finalRecommendationElement = document.getElementById('final-recommendation');
        finalRecommendationElement.innerHTML = `<span class="status status--${status}">${recommendation}</span>`;

        this.safeUpdateElement('recommendation-reasoning', reasoning);

        // Placeholder for confidence level
        this.safeUpdateElement('confidence-level', this.valuationResults.summary?.confidence || '--');
    }

    exportReport() {
        if (!this.stockData || !this.valuationResults) {
            this.showStatus('No data available to export report', 'error');
            return;
        }

        try {
            const { jsPDF } = window.jspdf;
            if (!jsPDF) {
                console.warn('jsPDF not available, generating text report');
                this.generateTextReport();
                this.showStatus('PDF library not available. Downloaded text report.', 'warning');
                return;
            }

            this.generatePDFReport(jsPDF);
            this.showStatus('PDF report generated and downloaded successfully!', 'success');

        } catch (error) {
            console.error('Error generating PDF report:', error);
            try {
                this.generateTextReport();
                this.showStatus('PDF generation failed. Downloaded text report.', 'warning');
            } catch (textError) {
                console.error('Text report generation failed:', textError);
                this.showStatus('Error generating report: ' + error.message, 'error');
            }
        }
    }

    generatePDFReport(jsPDFConstructor) {
        const doc = new jsPDFConstructor();

        const weightedValue = this.valuationResults.weighted_average;
        const currentPrice = this.stockData.current_price;
        const upside = ((weightedValue - currentPrice) / currentPrice) * 100;

        const pageWidth = doc.internal.pageSize.getWidth();
        const margin = 20;
        const lineHeight = 7;
        let yPosition = margin;

        const addText = (text, fontSize = 10, isBold = false) => {
            doc.setFontSize(fontSize);
            doc.setFont('helvetica', isBold ? 'bold' : 'normal');
            doc.text(text, margin, yPosition);
            yPosition += lineHeight;
        };

        const addCenteredText = (text, fontSize = 10, isBold = false) => {
            doc.setFontSize(fontSize);
            doc.setFont('helvetica', isBold ? 'bold' : 'normal');
            const textWidth = doc.getTextWidth(text);
            doc.text(text, (pageWidth - textWidth) / 2, yPosition);
            yPosition += lineHeight;
        };

        const addTableRow = (label, value, isHeader = false) => {
            doc.setFontSize(10);
            doc.setFont('helvetica', isHeader ? 'bold' : 'normal');

            if (isHeader) {
                doc.setFillColor(240, 240, 240);
                doc.rect(margin, yPosition - 5, pageWidth - 2 * margin, lineHeight, 'F');
            }

            doc.text(label, margin + 5, yPosition);
            doc.text(value, margin + 100, yPosition);

            doc.setDrawColor(200, 200, 200);
            doc.rect(margin, yPosition - 5, pageWidth - 2 * margin, lineHeight);

            yPosition += lineHeight;
        };

        addCenteredText('STOCK VALUATION REPORT', 18, true);
        addCenteredText(`${this.stockData.name} (${this.currentStock})`, 14, true);
        addCenteredText(`Date: ${new Date().toLocaleDateString('en-US')}`, 10);
        yPosition += 10;

        addText('Company Information', 14, true);
        yPosition += 3;
        addTableRow('Stock Symbol', this.stockData.symbol);
        addTableRow('Company Name', this.stockData.name);
        addTableRow('Industry', this.stockData.sector || '--');
        addTableRow('Exchange', this.stockData.exchange || '--');
        yPosition += 10;

        addText('Market Data', 14, true);
        yPosition += 3;
        addTableRow('Current Price', this.formatCurrency(currentPrice));
        addTableRow('Market Cap', this.formatLargeNumber(this.stockData.market_cap));
        addTableRow('P/E Ratio', this.formatNumber(this.stockData.pe_ratio));
        addTableRow('P/B Ratio', this.formatNumber(this.stockData.pb_ratio));
        addTableRow('EPS', this.formatCurrency(this.stockData.eps));
        yPosition += 10;

        addText('Valuation Results', 14, true);
        yPosition += 3;
        addTableRow('Model', 'Value (VND)', true);
        addTableRow('FCFE', this.formatCurrency(this.valuationResults.fcfe.shareValue));
        addTableRow('FCFF', this.formatCurrency(this.valuationResults.fcff.shareValue));
        addTableRow('Justified P/E', this.formatCurrency(this.valuationResults.justified_pe.shareValue));
        addTableRow('Justified P/B', this.formatCurrency(this.valuationResults.justified_pb.shareValue));

        doc.setFillColor(232, 245, 232);
        doc.rect(margin, yPosition - 5, pageWidth - 2 * margin, lineHeight, 'F');
        addTableRow('Weighted Average', this.formatCurrency(weightedValue), true);
        yPosition += 10;

        addText('Market Comparison', 14, true);
        yPosition += 3;
        addTableRow('Current Price', this.formatCurrency(currentPrice));
        addTableRow('Target Price', this.formatCurrency(weightedValue));
        addTableRow('Upside/Downside Potential', `${upside.toFixed(1)}%`);
        yPosition += 10;

        if (yPosition > 250) {
            doc.addPage();
            yPosition = margin;
        }

        addText('Assumptions Used', 14, true);
        yPosition += 3;
        addTableRow('Revenue Growth', `${this.assumptions.revenueGrowth}%`);
        addTableRow('Terminal Growth', `${this.assumptions.terminalGrowth}%`);
        addTableRow('WACC', `${this.assumptions.wacc}%`);
        addTableRow('Required Return', `${this.assumptions.requiredReturn}%`);
        addTableRow('Tax Rate', `${this.assumptions.taxRate}%`);
        addTableRow('Projection Years', `${this.assumptions.projectionYears}`);
        yPosition += 10;

        addText('Model Weights', 14, true);
        yPosition += 3;
        addTableRow('FCFE Weight', `${this.modelWeights.fcfe}%`);
        addTableRow('FCFF Weight', `${this.modelWeights.fcff}%`);
        addTableRow('P/E Weight', `${this.modelWeights.justified_pe}%`);
        addTableRow('P/B Weight', `${this.modelWeights.justified_pb}%`);

        if (this.valuationResults.market_comparison) {
            yPosition += 10;
            addText('Investment Recommendation', 14, true);
            yPosition += 3;
            addText(`Recommendation: ${this.valuationResults.market_comparison.recommendation}`, 12, true);
        }

        yPosition = doc.internal.pageSize.getHeight() - 20;
        addCenteredText('Generated by Stock Valuation Tool', 8);

        const fileName = `${this.currentStock}_valuation_report_${new Date().toISOString().split('T')[0]}.pdf`;
        doc.save(fileName);
    }

    generateTextReport() {
        const weightedValue = this.valuationResults.weighted_average;
        const currentPrice = this.stockData.current_price;
        const upside = ((weightedValue - currentPrice) / currentPrice) * 100;

        const reportContent = `
STOCK VALUATION REPORT
=====================
Company: ${this.stockData.name} (${this.currentStock})
Date: ${new Date().toLocaleDateString('en-US')}

COMPANY INFORMATION
------------------
Stock Symbol: ${this.stockData.symbol}
Company Name: ${this.stockData.name}
Industry: ${this.stockData.sector || '--'}
Exchange: ${this.stockData.exchange || '--'}

MARKET DATA
-----------
Current Price: ${this.formatCurrency(currentPrice)}
Market Cap: ${this.formatLargeNumber(this.stockData.market_cap)}
P/E Ratio: ${this.formatNumber(this.stockData.pe_ratio)}
P/B Ratio: ${this.formatNumber(this.stockData.pb_ratio)}
EPS: ${this.formatCurrency(this.stockData.eps)}

VALUATION RESULTS
----------------
FCFE: ${this.formatCurrency(this.valuationResults.fcfe.shareValue)} (Weight: ${this.modelWeights.fcfe}%)
FCFF: ${this.formatCurrency(this.valuationResults.fcff.shareValue)} (Weight: ${this.modelWeights.fcff}%)
Justified P/E: ${this.formatCurrency(this.valuationResults.justified_pe.shareValue)} (Weight: ${this.modelWeights.justified_pe}%)
Justified P/B: ${this.formatCurrency(this.valuationResults.justified_pb.shareValue)} (Weight: ${this.modelWeights.justified_pb}%)

WEIGHTED AVERAGE: ${this.formatCurrency(weightedValue)}

MARKET COMPARISON
----------------
Current Price: ${this.formatCurrency(currentPrice)}
Target Price: ${this.formatCurrency(weightedValue)}
Upside/Downside Potential: ${upside.toFixed(1)}%

ASSUMPTIONS USED
---------------
Revenue Growth: ${this.assumptions.revenueGrowth}%
Terminal Growth: ${this.assumptions.terminalGrowth}%
WACC: ${this.assumptions.wacc}%
Required Return: ${this.assumptions.requiredReturn}%
Tax Rate: ${this.assumptions.taxRate}%
Projection Years: ${this.assumptions.projectionYears}

Generated by Stock Valuation Tool
        `.trim();

        const blob = new Blob([reportContent], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${this.currentStock}_valuation_report_${new Date().toISOString().split('T')[0]}.txt`;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    showStatus(message, type) {
        const statusElement = document.getElementById('status-message');
        statusElement.textContent = message;
        statusElement.className = `status-message ${type}`;
        statusElement.classList.remove('hidden');

        setTimeout(() => {
            statusElement.classList.add('hidden');
        }, 5000);
    }

    showLoading(show) {
        const loadBtn = document.getElementById('load-data-btn');
        if (show) {
            loadBtn.textContent = 'Loading...';
            loadBtn.disabled = true;
        } else {
            loadBtn.textContent = 'Load Company Data';
            loadBtn.disabled = false;
        }
    }

    clearDisplay() {
        // Clear company info
        this.safeUpdateElement('company-name', '--');
        this.safeUpdateElement('company-symbol', '--');
        this.safeUpdateElement('company-sector', '--');
        this.safeUpdateElement('company-exchange', '--');

        // Clear market data
        this.safeUpdateElement('current-price', '--');
        this.safeUpdateElement('market-cap', '--');
        this.safeUpdateElement('pe-ratio', '--');
        this.safeUpdateElement('pb-ratio', '--');
        this.safeUpdateElement('ps-ratio', '--');
        this.safeUpdateElement('eps', '--');
        this.safeUpdateElement('book-value-per-share', '--');
        this.safeUpdateElement('ev-ebitda', '--');

        // Clear financial metrics
        this.safeUpdateElement('revenue', '--');
        this.safeUpdateElement('net-income', '--');
        this.safeUpdateElement('ebitda', '--');
        this.safeUpdateElement('roe', '--');
        this.safeUpdateElement('roa', '--');
        this.safeUpdateElement('debt-equity', '--');

        // Clear ratio metrics
        this.safeUpdateElement('asset-turnover', '--');
        this.safeUpdateElement('inventory-turnover', '--');
        this.safeUpdateElement('fixed-asset-turnover', '--');
        this.safeUpdateElement('current-ratio', '--');
        this.safeUpdateElement('quick-ratio', '--');
        this.safeUpdateElement('cash-ratio', '--');
        this.safeUpdateElement('interest-coverage', '--');
        this.safeUpdateElement('gross-profit-margin', '--');
        this.safeUpdateElement('ebit-margin', '--');
        this.safeUpdateElement('net-profit-margin', '--');
        this.safeUpdateElement('ev-ebitda-ratio', '--');

        // Clear valuation results
        this.safeUpdateElement('fcfe-result', '--');
        this.safeUpdateElement('fcff-result', '--');
        this.safeUpdateElement('pe-result', '--');
        this.safeUpdateElement('pb-result', '--');
        this.safeUpdateElement('weighted-result', '--');
        this.safeUpdateElement('fcfe-diff', '--');
        this.safeUpdateElement('fcff-diff', '--');
        this.safeUpdateElement('pe-diff', '--');
        this.safeUpdateElement('pb-diff', '--');
        this.safeUpdateElement('weighted-diff', '--');

        // Clear summary tab
        this.safeUpdateElement('summary-symbol', '--');
        this.safeUpdateElement('summary-name', '--');
        this.safeUpdateElement('summary-sector', '--');
        this.safeUpdateElement('summary-exchange', '--');
        this.safeUpdateElement('summary-price', '--');
        this.safeUpdateElement('summary-market-cap', '--');
        this.safeUpdateElement('summary-pe', '--');
        this.safeUpdateElement('summary-pb', '--');
        this.safeUpdateElement('target-price', '--');
        this.safeUpdateElement('summary-potential', '--');
        this.safeUpdateElement('return-value', '--');

        // Clear model details
        this.safeUpdateElement('fcfe-equity', '--');
        this.safeUpdateElement('fcfe-share-value', '--');
        this.safeUpdateElement('fcfe-market-diff', '--');
        this.safeUpdateElement('fcff-ev', '--');
        this.safeUpdateElement('fcff-equity', '--');
        this.safeUpdateElement('fcff-share-value', '--');
        this.safeUpdateElement('fcff-market-diff', '--');
        this.safeUpdateElement('pe-justified-ratio', '--');
        this.safeUpdateElement('pe-current-eps', '--');
        this.safeUpdateElement('pe-share-value', '--');
        this.safeUpdateElement('pe-market-diff', '--');
        this.safeUpdateElement('pb-justified-ratio', '--');
        this.safeUpdateElement('pb-current-bvps', '--');
        this.safeUpdateElement('pb-share-value', '--');
        this.safeUpdateElement('pb-market-diff', '--');

        // Clear recommendation
        const recommendationElement = document.getElementById('recommendation');
        recommendationElement.innerHTML = '<span class="status status--warning">--</span>';
        const finalRecommendationElement = document.getElementById('final-recommendation');
        finalRecommendationElement.innerHTML = '<span class="status status--warning">--</span>';
        this.safeUpdateElement('recommendation-reasoning', 'Please load company data to receive investment recommendations.');
        this.safeUpdateElement('confidence-level', '--');

        // Disable export button
        document.getElementById('export-report-btn').disabled = true;

        // Clear valuation results
        this.valuationResults = null;
    }

    formatCurrency(value) {
        if (!value || isNaN(value)) return '--';
        return new Intl.NumberFormat('vi-VN', {
            style: 'currency',
            currency: 'VND',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(value);
    }

    formatLargeNumber(value) {
        if (!value || isNaN(value)) return '--';
        if (value >= 1e12) {
            return `${(value / 1e12).toFixed(1)} trillion`;
        } else if (value >= 1e9) {
            return `${(value / 1e9).toFixed(1)} billion`;
        } else if (value >= 1e6) {
            return `${(value / 1e6).toFixed(1)} million`;
        } else {
            return this.formatCurrency(value);
        }
    }

    formatNumber(value) {
        if (!value || isNaN(value)) return '--';
        return value.toFixed(2);
    }

    formatPercent(value) {
        if (!value || isNaN(value)) return '--';
        return `${value.toFixed(1)}%`;
    }

    updateOverviewDisplay(data) {
        // Update company info
        this.safeUpdateElement('company-name', data.name || '--');
        this.safeUpdateElement('company-symbol', data.symbol || '--');
        this.safeUpdateElement('company-sector', data.sector || '--');
        this.safeUpdateElement('company-exchange', data.exchange || '--');

        // Update market data
        this.safeUpdateElement('current-price', this.formatCurrency(data.current_price));
        this.safeUpdateElement('market-cap', this.formatLargeNumber(data.market_cap));
        this.safeUpdateElement('pe-ratio', this.formatNumber(data.pe_ratio));
        this.safeUpdateElement('pb-ratio', this.formatNumber(data.pb_ratio));
        this.safeUpdateElement('ps-ratio', this.formatNumber(data.ps_ratio));
        this.safeUpdateElement('eps', this.formatCurrency(data.eps));
        this.safeUpdateElement('book-value-per-share', this.formatCurrency(data.book_value_per_share));
        this.safeUpdateElement('ev-ebitda', this.formatNumber(data.ev_ebitda));

        // Update financial metrics
        this.safeUpdateElement('revenue', this.formatLargeNumber(data.revenue_ttm));
        this.safeUpdateElement('net-income', this.formatLargeNumber(data.net_income_ttm));
        this.safeUpdateElement('ebitda', this.formatLargeNumber(data.ebitda));
        this.safeUpdateElement('roe', this.formatPercent(data.roe));
        this.safeUpdateElement('roa', this.formatPercent(data.roa));
        this.safeUpdateElement('debt-equity', this.formatNumber(data.debt_to_equity));

        // Update ratio metrics
        this.safeUpdateElement('asset-turnover', this.formatNumber(data.asset_turnover));
        this.safeUpdateElement('inventory-turnover', this.formatNumber(data.inventory_turnover));
        this.safeUpdateElement('fixed-asset-turnover', this.formatNumber(data.fixed_asset_turnover));
        this.safeUpdateElement('current-ratio', this.formatNumber(data.current_ratio));
        this.safeUpdateElement('quick-ratio', this.formatNumber(data.quick_ratio));
        this.safeUpdateElement('cash-ratio', this.formatNumber(data.cash_ratio));
        this.safeUpdateElement('interest-coverage', this.formatNumber(data.interest_coverage));
        this.safeUpdateElement('gross-profit-margin', this.formatPercent(data.gross_profit_margin));
        this.safeUpdateElement('ebit-margin', this.formatPercent(data.ebit_margin));
        this.safeUpdateElement('net-profit-margin', this.formatPercent(data.net_profit_margin));
        this.safeUpdateElement('ev-ebitda-ratio', this.formatNumber(data.ev_ebitda));

        // Update summary tab
        this.safeUpdateElement('summary-symbol', data.symbol || '--');
        this.safeUpdateElement('summary-name', data.name || '--');
        this.safeUpdateElement('summary-sector', data.sector || '--');
        this.safeUpdateElement('summary-exchange', data.exchange || '--');
        this.safeUpdateElement('summary-price', this.formatCurrency(data.current_price));
        this.safeUpdateElement('summary-market-cap', this.formatLargeNumber(data.market_cap));
        this.safeUpdateElement('summary-pe', this.formatNumber(data.pe_ratio));
        this.safeUpdateElement('summary-pb', this.formatNumber(data.pb_ratio));
    }    updateModelDetails() {
        if (!this.valuationResults || !this.stockData) {
            return;
        }

        const currentPrice = this.stockData.current_price;

        let eps = this.valuationResults.financial_data.eps || this.stockData.eps || 0;
        let bvps = this.stockData.book_value_per_share || 0;

        // FCFE Details
        const fcfeEquityValue = this.valuationResults.fcfe.equityValue;
        this.safeUpdateElement('fcfe-equity', this.formatCurrency(fcfeEquityValue));
        this.safeUpdateElement('fcfe-share-value', this.formatCurrency(this.valuationResults.fcfe.shareValue));
        const fcfeDiff = ((this.valuationResults.fcfe.shareValue - currentPrice) / currentPrice) * 100;
        this.safeUpdateElement('fcfe-market-diff', `${fcfeDiff > 0 ? '+' : ''}${fcfeDiff.toFixed(1)}%`);

        // FCFF Details
        const fcffEquityValue = this.valuationResults.fcff.equityValue;
        const fcffEV = fcffEquityValue + (this.stockData.total_debt || 0);
        this.safeUpdateElement('fcff-ev', this.formatCurrency(fcffEV));
        this.safeUpdateElement('fcff-equity', this.formatCurrency(fcffEquityValue));
        this.safeUpdateElement('fcff-share-value', this.formatCurrency(this.valuationResults.fcff.shareValue));
        const fcffDiff = ((this.valuationResults.fcff.shareValue - currentPrice) / currentPrice) * 100;
        this.safeUpdateElement('fcff-market-diff', `${fcffDiff > 0 ? '+' : ''}${fcffDiff.toFixed(1)}%`);

        // Justified P/E Details
        const justifiedPE = eps > 0 ? Math.abs(this.valuationResults.justified_pe.shareValue / eps) : 0;
        this.safeUpdateElement('pe-justified-ratio', `${justifiedPE.toFixed(2)}x`);
        this.safeUpdateElement('pe-current-eps', this.formatCurrency(eps));
        this.safeUpdateElement('pe-share-value', this.formatCurrency(this.valuationResults.justified_pe.shareValue));
        const peDiff = ((this.valuationResults.justified_pe.shareValue - currentPrice) / currentPrice) * 100;
        this.safeUpdateElement('pe-market-diff', `${peDiff > 0 ? '+' : ''}${peDiff.toFixed(1)}%`);

        // Justified P/B Details
        const justifiedPB = bvps > 0 ? Math.abs(this.valuationResults.justified_pb.shareValue / bvps) : 0;
        this.safeUpdateElement('pb-justified-ratio', `${justifiedPB.toFixed(2)}x`);
        this.safeUpdateElement('pb-current-bvps', this.formatCurrency(bvps));
        this.safeUpdateElement('pb-share-value', this.formatCurrency(this.valuationResults.justified_pb.shareValue));
        const pbDiff = ((this.valuationResults.justified_pb.shareValue - currentPrice) / currentPrice) * 100;
        this.safeUpdateElement('pb-market-diff', `${pbDiff > 0 ? '+' : ''}${pbDiff.toFixed(1)}%`);
          // Update target price and summary
        this.safeUpdateElement('target-price', this.formatCurrency(this.valuationResults.weighted_average));
        const upside = ((this.valuationResults.weighted_average - currentPrice) / currentPrice) * 100;
        this.safeUpdateElement('summary-potential', `${upside > 0 ? '+' : ''}${upside.toFixed(1)}%`);
        
        // Update recommendation for page 3
        this.updateRecommendation();
    }

    safeUpdateElement(id, value) {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = value;
        }
    }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    // Load Chart.js dynamically
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/chart.js';
    script.onload = () => {
        new StockValuationApp();
    };
    script.onerror = () => {
        console.error('Failed to load Chart.js');
        new StockValuationApp(); // Proceed without charts
    };
    document.head.appendChild(script);
});