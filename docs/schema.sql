-- =====================================================================
-- 每日市場反思與提問系統：資料庫 Schema（PostgreSQL / SQLite 皆可用）
--
-- 目前「免費版」部署不需要資料庫：
--   * 系統提問 → data/questions/YYYY-MM-DD.json（GitHub Actions 自動 commit）
--   * 使用者回答 → 瀏覽器 localStorage，選用同步到私人 repo 的 journal.json
-- 若日後要改成有後端（FastAPI + Supabase 免費方案等），用以下結構即可一對一匯入。
-- =====================================================================

-- 1) 每日市場快照：當日關鍵宏觀數據（一天一列）
CREATE TABLE market_snapshot (
    trade_date      DATE PRIMARY KEY,          -- 美股交易日（美東）
    vix             NUMERIC(8,2),
    dxy             NUMERIC(8,3),
    us10y           NUMERIC(6,3),              -- %
    us02y           NUMERIC(6,3),              -- %
    spread_10y2y    NUMERIC(6,3),              -- %
    hy_oas          NUMERIC(6,2),              -- %
    usdjpy          NUMERIC(8,3),
    usdtwd          NUMERIC(8,3),
    btc_usdt        NUMERIC(14,2),
    taiex           NUMERIC(10,2),
    spx             NUMERIC(10,2),
    sox             NUMERIC(10,2),
    gold            NUMERIC(10,2),
    wti             NUMERIC(8,2),
    copper          NUMERIC(8,4),
    events          TEXT,                       -- 例：'CPI,FOMC'
    data_quality    TEXT,                       -- JSON：各指標交叉比對結果
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2) 每日推敲日誌：系統提問 1-3、使用者回答 1-3（需求指定欄位）
CREATE TABLE deduction_journal (
    journal_date    DATE PRIMARY KEY REFERENCES market_snapshot(trade_date),
    question_1      TEXT NOT NULL,
    question_2      TEXT NOT NULL,
    question_3      TEXT NOT NULL,
    hint_1          TEXT,
    hint_2          TEXT,
    hint_3          TEXT,
    answer_1        TEXT,
    answer_2        TEXT,
    answer_3        TEXT,
    question_engine VARCHAR(10) DEFAULT 'rules', -- rules | llm
    top_movers      TEXT,                         -- JSON：當日 z-score 排名
    answered_at     TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3) 事件日標記（CPI / NFP / ISM / FOMC），供「按日曆回顧極端事件」查詢
CREATE TABLE macro_event (
    event_date      DATE NOT NULL,
    event_code      VARCHAR(16) NOT NULL,         -- CPI, NFP, PPI, ISM, FOMC
    PRIMARY KEY (event_date, event_code)
);

CREATE INDEX idx_event_code ON macro_event(event_code);

-- 範例查詢：回顧過去所有 CPI 發布日，當天 VIX、DXY 與我的判斷
-- SELECT s.trade_date, s.vix, s.dxy, s.us02y, j.question_1, j.answer_1
-- FROM macro_event e
-- JOIN market_snapshot s ON s.trade_date = e.event_date
-- LEFT JOIN deduction_journal j ON j.journal_date = e.event_date
-- WHERE e.event_code = 'CPI'
-- ORDER BY s.trade_date DESC;
