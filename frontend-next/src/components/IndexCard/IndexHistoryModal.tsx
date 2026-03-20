'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogPanel, Title, Select, SelectItem, Button, Icon } from '@tremor/react';
import { RiCloseLine, RiDownloadLine } from '@remixicon/react';
import { cx } from '@/lib/utils';
import { API_BASE, INDEX_MAP } from '@/lib/api';

interface IndexHistoryModalProps {
    isOpen: boolean;
    onClose: () => void;
    indexId: string;
    indexName: string;
}

export default function IndexHistoryModal({ isOpen, onClose, indexId, indexName }: IndexHistoryModalProps) {
    const [days, setDays] = useState('90');
    const [data, setData] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!isOpen) return;

        const info = Object.values(INDEX_MAP).find(i => i.id === indexId);
        const symbol = info ? info.vciSymbol : indexId;

        const fetchData = async () => {
            setLoading(true);
            try {
                const res = await fetch(`${API_BASE}/market/index-history?index=${symbol}&days=${days}`);
                const json = await res.json();
                if (Array.isArray(json)) {
                    setData(json);
                } else {
                    setData([]);
                }
            } catch (err) {
                console.error(err);
                setData([]);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [isOpen, indexId, days]);

    const handleExportCSV = () => {
        if (!data || data.length === 0) return;
        const headers = [
            'Ngày', 'Giá trị thay đổi', '% thay đổi', 'Đóng cửa', 'Cao nhất', 'Thấp nhất',
            'KLGD khớp lệnh', 'GTGD khớp lệnh (Triệu)', 'KLGD thỏa thuận', 'GTGD thỏa thuận (Triệu)',
            'Mã Tăng', 'Mã Đứng', 'Mã Giảm'
        ];

        const rows = data.map(item => [
            item.tradingDate,
            item.indexChange?.toFixed(2) || '',
            item.percentIndexChange?.toFixed(2) || '',
            item.closeIndex?.toFixed(2) || '',
            item.highestIndex?.toFixed(2) || '',
            item.lowestIndex?.toFixed(2) || '',
            item.totalMatchVolume || '',
            ((item.totalMatchValue || 0) / 1000000).toFixed(2),
            item.totalDealVolume || '',
            ((item.totalDealValue || 0) / 1000000).toFixed(2),
            item.totalStockUpPrice || '',
            item.totalStockNoChangePrice || '',
            item.totalStockDownPrice || ''
        ]);

        // Add BOM for Excel utf8 encoding
        const csvContent = "data:text/csv;charset=utf-8,\uFEFF"
            + headers.join(",") + "\n"
            + rows.map(e => e.join(",")).join("\n");

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `LichSu_${indexName.replace(/\s+/g, '_')}_${days}ngay.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <Dialog open={isOpen} onClose={onClose} static={true} className="z-[100]">
            <DialogPanel className="max-w-6xl p-4 md:p-6 bg-tremor-background dark:bg-dark-tremor-background ring-1 ring-tremor-ring dark:ring-dark-tremor-ring">
                <div className="flex justify-between items-center mb-4">
                    <Title className="text-xl font-bold">Lịch sử {indexName}</Title>
                    <button onClick={onClose} className="text-tremor-content-subtle hover:text-tremor-content">
                        <Icon icon={RiCloseLine} size="lg" />
                    </button>
                </div>

                <div className="flex gap-4 items-center mb-4 flex-wrap">
                    <Select value={days} onValueChange={setDays} className="w-48">
                        <SelectItem value="90">3M</SelectItem>
                        <SelectItem value="180">6M</SelectItem>
                        <SelectItem value="365">1Y</SelectItem>
                        <SelectItem value="1095">3Y</SelectItem>
                        <SelectItem value="1825">5Y</SelectItem>
                    </Select>
                    <Button icon={RiDownloadLine} onClick={handleExportCSV}>Export CSV</Button>
                </div>

                <div className="overflow-x-auto max-h-[60vh] border border-tremor-border dark:border-dark-tremor-border rounded">
                    <table className="w-full text-sm text-left whitespace-nowrap">
                        <thead className="sticky top-0 bg-tremor-background-muted dark:bg-dark-tremor-background-muted text-tremor-content dark:text-dark-tremor-content">
                            <tr>
                                <th className="px-3 py-2 border-b dark:border-dark-tremor-border font-semibold">Ngày</th>
                                <th colSpan={2} className="px-3 py-2 border-b dark:border-dark-tremor-border text-center border-l dark:border-dark-tremor-border font-semibold">Thay đổi</th>
                                <th colSpan={3} className="px-3 py-2 border-b dark:border-dark-tremor-border text-center border-l dark:border-dark-tremor-border font-semibold">Giá</th>
                                <th colSpan={2} className="px-3 py-2 border-b dark:border-dark-tremor-border text-center border-l dark:border-dark-tremor-border font-semibold">GD khớp lệnh</th>
                                <th colSpan={2} className="px-3 py-2 border-b dark:border-dark-tremor-border text-center border-l dark:border-dark-tremor-border font-semibold">GD thỏa thuận</th>
                                <th className="px-3 py-2 border-b dark:border-dark-tremor-border text-center border-l dark:border-dark-tremor-border font-semibold">CK Tăng giảm</th>
                            </tr>
                            <tr className="text-[11px] uppercase tracking-wider font-medium text-tremor-content-subtle dark:text-dark-tremor-content-subtle border-b dark:border-dark-tremor-border">
                                <th className="px-3 py-1"></th>
                                <th className="px-3 py-1 border-l dark:border-dark-tremor-border text-right">Giá trị</th>
                                <th className="px-3 py-1 text-right">%</th>
                                <th className="px-3 py-1 border-l dark:border-dark-tremor-border text-right">Đóng cửa</th>
                                <th className="px-3 py-1 text-right">Cao nhất</th>
                                <th className="px-3 py-1 text-right">Thấp nhất</th>
                                <th className="px-3 py-1 border-l dark:border-dark-tremor-border text-right">KLGD (CP)</th>
                                <th className="px-3 py-1 text-right">GTGD (Triệu)</th>
                                <th className="px-3 py-1 border-l dark:border-dark-tremor-border text-right">KLGD (CP)</th>
                                <th className="px-3 py-1 text-right">GTGD (Triệu)</th>
                                <th className="px-3 py-1 border-l dark:border-dark-tremor-border text-center">T/Đ/G</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={11} className="text-center py-8 text-tremor-content-subtle">
                                        Đang tải dữ liệu...
                                    </td>
                                </tr>
                            ) : data.length === 0 ? (
                                <tr>
                                    <td colSpan={11} className="text-center py-8 text-tremor-content-subtle">
                                        Không có dữ liệu
                                    </td>
                                </tr>
                            ) : data.map((row, idx) => {
                                const isUp = row.indexChange >= 0;
                                const isZero = Math.abs(row.indexChange || 0) < 0.001;
                                const colorClass = isUp ? (isZero ? 'text-amber-500' : 'text-emerald-500') : 'text-red-500';

                                return (
                                    <tr key={idx} className="border-b dark:border-dark-tremor-border hover:bg-tremor-background-muted dark:hover:bg-dark-tremor-background-muted transition-colors font-medium">
                                        <td className="px-3 py-2 text-tremor-content-strong dark:text-dark-tremor-content-strong">{row.tradingDate}</td>

                                        <td className={cx("px-3 py-2 text-right border-l dark:border-dark-tremor-border", colorClass)}>
                                            {row.indexChange?.toFixed(2) || '0.00'}
                                        </td>
                                        <td className={cx("px-3 py-2 text-right", colorClass)}>
                                            {row.percentIndexChange?.toFixed(2) || '0.0'}%
                                        </td>

                                        <td className={cx("px-3 py-2 text-right border-l dark:border-dark-tremor-border font-bold", colorClass)}>
                                            {row.closeIndex?.toLocaleString('en-US', { maximumFractionDigits: 2 }) || '0.00'}
                                        </td>
                                        <td className="px-3 py-2 text-right text-tremor-content-strong dark:text-dark-tremor-content-strong">
                                            {row.highestIndex?.toLocaleString('en-US', { maximumFractionDigits: 2 }) || '0.00'}
                                        </td>
                                        <td className="px-3 py-2 text-right text-tremor-content-strong dark:text-dark-tremor-content-strong">
                                            {row.lowestIndex?.toLocaleString('en-US', { maximumFractionDigits: 2 }) || '0.00'}
                                        </td>

                                        <td className="px-3 py-2 text-right border-l dark:border-dark-tremor-border text-tremor-content-strong dark:text-dark-tremor-content-strong">
                                            {row.totalMatchVolume?.toLocaleString('en-US') || '0'}
                                        </td>
                                        <td className="px-3 py-2 text-right text-tremor-content-strong dark:text-dark-tremor-content-strong">
                                            {((row.totalMatchValue || 0) / 1000000).toLocaleString('en-US', { maximumFractionDigits: 2 })}
                                        </td>

                                        <td className="px-3 py-2 text-right border-l dark:border-dark-tremor-border text-tremor-content-strong dark:text-dark-tremor-content-strong">
                                            {row.totalDealVolume?.toLocaleString('en-US') || '0'}
                                        </td>
                                        <td className="px-3 py-2 text-right text-tremor-content-strong dark:text-dark-tremor-content-strong">
                                            {((row.totalDealValue || 0) / 1000000).toLocaleString('en-US', { maximumFractionDigits: 2 })}
                                        </td>

                                        <td className="px-3 py-2 text-center border-l dark:border-dark-tremor-border whitespace-nowrap">
                                            <span className="text-emerald-500 inline-block text-right">↑{row.totalStockUpPrice || 0}</span>
                                            <span className="text-amber-500 inline-block text-center px-2">●{row.totalStockNoChangePrice || 0}</span>
                                            <span className="text-red-500 inline-block text-left">↓{row.totalStockDownPrice || 0}</span>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </DialogPanel>
        </Dialog>
    );
}
