/** 題組顯示設定（反思區與日誌共用） */
export const GROUPS = {
  market: { label: '▍市場推敲', cls: 'text-s1' },
  flow: { label: '▍資金流向推敲（對照上方資金流向圖）', cls: 'text-s2' },
  asset: { label: '▍美元・黃金・加密', cls: 'text-s3' },
}
export const typeOf = (t, i) => t || (i >= 6 ? 'asset' : i >= 3 ? 'flow' : 'market')
export const groupOf = (t, i) => GROUPS[typeOf(t, i)] || GROUPS.market
