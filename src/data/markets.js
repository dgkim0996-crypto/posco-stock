export const INITIAL_MARKETS = {
  stocks: [
    // POSCO Group
    { id:"005490", symbol:"005490", name:"POSCO홀딩스", price:345000, change:1.15, unit:"KRW", market:"KOSPI", group:"POSCO" },
    { id:"003670", symbol:"003670", name:"포스코퓨처엠", price:186500, change:0.82, unit:"KRW", market:"KOSPI", group:"POSCO" },
    { id:"047050", symbol:"047050", name:"포스코인터내셔널", price:51200, change:-0.35, unit:"KRW", market:"KOSPI", group:"POSCO" },
    { id:"022100", symbol:"022100", name:"포스코DX", price:34750, change:1.64, unit:"KRW", market:"KOSPI", group:"POSCO" },
    { id:"058430", symbol:"058430", name:"포스코스틸리온", price:38650, change:0.41, unit:"KRW", market:"KOSPI", group:"POSCO" },
    { id:"009520", symbol:"009520", name:"포스코엠텍", price:13120, change:3.14, unit:"KRW", market:"KOSDAQ", group:"POSCO" },

    // Korea major stocks
    { id:"005930", symbol:"005930", name:"삼성전자", price:82400, change:1.20, unit:"KRW", market:"KOSPI" },
    { id:"000660", symbol:"000660", name:"SK하이닉스", price:221500, change:-0.60, unit:"KRW", market:"KOSPI" },
    { id:"035420", symbol:"035420", name:"NAVER", price:196800, change:0.80, unit:"KRW", market:"KOSPI" },
    { id:"035720", symbol:"035720", name:"카카오", price:62400, change:-0.42, unit:"KRW", market:"KOSPI" },

    // ETF / index products
    { id:"069500", symbol:"069500", name:"KODEX 200", price:36540, change:0.48, unit:"KRW", market:"KOSPI", group:"ETF" },
    { id:"133690", symbol:"133690", name:"TIGER 미국나스닥100", price:142350, change:0.77, unit:"KRW", market:"KOSPI", group:"ETF" },
    { id:"305720", symbol:"305720", name:"KODEX 2차전지산업", price:17680, change:-0.36, unit:"KRW", market:"KOSPI", group:"ETF" },
    { id:"QQQ", symbol:"QQQ", name:"Invesco QQQ", price:576.30, change:0.69, unit:"USD", market:"NASDAQ", group:"ETF" },
    { id:"SPY", symbol:"SPY", name:"SPDR S&P 500 ETF", price:649.10, change:0.34, unit:"USD", market:"NYSE", group:"ETF" },

    // Global Big Tech / AI
    { id:"AAPL", symbol:"AAPL", name:"Apple", price:231.70, change:0.44, unit:"USD", market:"NASDAQ" },
    { id:"MSFT", symbol:"MSFT", name:"Microsoft", price:507.80, change:0.71, unit:"USD", market:"NASDAQ" },
    { id:"NVDA", symbol:"NVDA", name:"NVIDIA", price:181.40, change:2.10, unit:"USD", market:"NASDAQ" },
    { id:"GOOGL", symbol:"GOOGL", name:"Alphabet", price:205.30, change:0.58, unit:"USD", market:"NASDAQ" },
    { id:"AMZN", symbol:"AMZN", name:"Amazon", price:231.10, change:1.02, unit:"USD", market:"NASDAQ" },
    { id:"META", symbol:"META", name:"Meta Platforms", price:754.20, change:1.26, unit:"USD", market:"NASDAQ" },
    { id:"TSLA", symbol:"TSLA", name:"Tesla", price:345.60, change:-1.18, unit:"USD", market:"NASDAQ" },
    { id:"AVGO", symbol:"AVGO", name:"Broadcom", price:324.90, change:1.78, unit:"USD", market:"NASDAQ" },
    { id:"ORCL", symbol:"ORCL", name:"Oracle", price:242.80, change:0.62, unit:"USD", market:"NYSE" },
    { id:"NFLX", symbol:"NFLX", name:"Netflix", price:1246.40, change:0.84, unit:"USD", market:"NASDAQ" },
    { id:"PLTR", symbol:"PLTR", name:"Palantir", price:158.20, change:2.42, unit:"USD", market:"NASDAQ" },

    // Semiconductors
    { id:"AMD", symbol:"AMD", name:"AMD", price:176.20, change:1.34, unit:"USD", market:"NASDAQ" },
    { id:"INTC", symbol:"INTC", name:"Intel", price:29.40, change:-0.52, unit:"USD", market:"NASDAQ" },
    { id:"QCOM", symbol:"QCOM", name:"Qualcomm", price:169.80, change:0.75, unit:"USD", market:"NASDAQ" },
    { id:"MU", symbol:"MU", name:"Micron Technology", price:129.30, change:1.11, unit:"USD", market:"NASDAQ" },
    { id:"TXN", symbol:"TXN", name:"Texas Instruments", price:201.70, change:0.31, unit:"USD", market:"NASDAQ" },
    { id:"ARM", symbol:"ARM", name:"Arm Holdings", price:152.90, change:1.86, unit:"USD", market:"NASDAQ" },
    { id:"TSM", symbol:"TSM", name:"TSMC ADR", price:241.60, change:1.52, unit:"USD", market:"NYSE" },
    { id:"ASML", symbol:"ASML", name:"ASML Holding", price:886.40, change:0.93, unit:"USD", market:"NASDAQ" },
    { id:"AMAT", symbol:"AMAT", name:"Applied Materials", price:189.20, change:1.09, unit:"USD", market:"NASDAQ" },
    { id:"LRCX", symbol:"LRCX", name:"Lam Research", price:101.80, change:1.43, unit:"USD", market:"NASDAQ" },
    { id:"KLAC", symbol:"KLAC", name:"KLA", price:892.10, change:0.88, unit:"USD", market:"NASDAQ" },
    { id:"MRVL", symbol:"MRVL", name:"Marvell Technology", price:79.60, change:1.67, unit:"USD", market:"NASDAQ" },
    { id:"ADI", symbol:"ADI", name:"Analog Devices", price:239.30, change:0.36, unit:"USD", market:"NASDAQ" },
    { id:"MCHP", symbol:"MCHP", name:"Microchip Technology", price:71.80, change:-0.27, unit:"USD", market:"NASDAQ" },
    { id:"NXPI", symbol:"NXPI", name:"NXP Semiconductors", price:226.40, change:0.55, unit:"USD", market:"NASDAQ" },
    { id:"ON", symbol:"ON", name:"ON Semiconductor", price:56.70, change:-0.44, unit:"USD", market:"NASDAQ" },

    // Software / Cloud / Cybersecurity
    { id:"CRM", symbol:"CRM", name:"Salesforce", price:262.40, change:0.76, unit:"USD", market:"NYSE" },
    { id:"ADBE", symbol:"ADBE", name:"Adobe", price:354.80, change:-0.21, unit:"USD", market:"NASDAQ" },
    { id:"NOW", symbol:"NOW", name:"ServiceNow", price:936.50, change:0.95, unit:"USD", market:"NYSE" },
    { id:"SNOW", symbol:"SNOW", name:"Snowflake", price:224.10, change:1.63, unit:"USD", market:"NYSE" },
    { id:"DDOG", symbol:"DDOG", name:"Datadog", price:141.20, change:1.21, unit:"USD", market:"NASDAQ" },
    { id:"MDB", symbol:"MDB", name:"MongoDB", price:247.50, change:0.79, unit:"USD", market:"NASDAQ" },
    { id:"NET", symbol:"NET", name:"Cloudflare", price:194.40, change:1.58, unit:"USD", market:"NYSE" },
    { id:"CRWD", symbol:"CRWD", name:"CrowdStrike", price:438.30, change:1.17, unit:"USD", market:"NASDAQ" },
    { id:"PANW", symbol:"PANW", name:"Palo Alto Networks", price:205.60, change:0.83, unit:"USD", market:"NASDAQ" },
    { id:"FTNT", symbol:"FTNT", name:"Fortinet", price:82.70, change:0.46, unit:"USD", market:"NASDAQ" },
    { id:"ZS", symbol:"ZS", name:"Zscaler", price:287.10, change:1.06, unit:"USD", market:"NASDAQ" },
    { id:"OKTA", symbol:"OKTA", name:"Okta", price:92.80, change:-0.35, unit:"USD", market:"NASDAQ" },
    { id:"TEAM", symbol:"TEAM", name:"Atlassian", price:173.90, change:0.66, unit:"USD", market:"NASDAQ" },
    { id:"WDAY", symbol:"WDAY", name:"Workday", price:224.50, change:0.43, unit:"USD", market:"NASDAQ" },
    { id:"INTU", symbol:"INTU", name:"Intuit", price:669.20, change:0.72, unit:"USD", market:"NASDAQ" },
    { id:"ADSK", symbol:"ADSK", name:"Autodesk", price:287.60, change:0.51, unit:"USD", market:"NASDAQ" },

    // Networking / Hardware / Enterprise Tech
    { id:"CSCO", symbol:"CSCO", name:"Cisco Systems", price:69.20, change:0.28, unit:"USD", market:"NASDAQ" },
    { id:"IBM", symbol:"IBM", name:"IBM", price:248.80, change:0.39, unit:"USD", market:"NYSE" },
    { id:"DELL", symbol:"DELL", name:"Dell Technologies", price:126.60, change:0.91, unit:"USD", market:"NYSE" },
    { id:"HPE", symbol:"HPE", name:"Hewlett Packard Enterprise", price:22.90, change:0.34, unit:"USD", market:"NYSE" },
    { id:"SMCI", symbol:"SMCI", name:"Super Micro Computer", price:45.70, change:1.92, unit:"USD", market:"NASDAQ" },
    { id:"SAP", symbol:"SAP", name:"SAP SE ADR", price:286.30, change:0.47, unit:"USD", market:"NYSE" },

    // Internet / Platform Tech
    { id:"SHOP", symbol:"SHOP", name:"Shopify", price:143.70, change:1.13, unit:"USD", market:"NASDAQ" },
    { id:"UBER", symbol:"UBER", name:"Uber Technologies", price:94.60, change:0.89, unit:"USD", market:"NYSE" },
    { id:"ABNB", symbol:"ABNB", name:"Airbnb", price:132.50, change:-0.31, unit:"USD", market:"NASDAQ" },
    { id:"RBLX", symbol:"RBLX", name:"Roblox", price:117.80, change:1.48, unit:"USD", market:"NYSE" }
  ],
  futures: [
    { id:"K200", symbol:"K200", name:"KOSPI200 FUT", price:431.25, change:0.3, unit:"PTS", multiplier:250000, marginRate:0.08 },
    { id:"NQ", symbol:"NQ", name:"NASDAQ100 FUT", price:24182.5, change:-0.4, unit:"PTS", multiplier:20, marginRate:0.10 },
    { id:"ES", symbol:"ES", name:"S&P500 FUT", price:6488.25, change:0.2, unit:"PTS", multiplier:50, marginRate:0.10 },
    { id:"CL", symbol:"CL", name:"WTI CRUDE", price:73.18, change:1.0, unit:"USD", multiplier:1000, marginRate:0.12 },
    { id:"GC", symbol:"GC", name:"GOLD FUT", price:2528.4, change:0.6, unit:"USD", multiplier:100, marginRate:0.09 }
  ],
  bonds: [
    { id:"KR3Y", symbol:"KR3Y", name:"한국 국채 3년", price:100000, yield:2.88, coupon:2.60, maturity:"2029-06", duration:2.7, change:0, unit:"KRW" },
    { id:"KR10Y", symbol:"KR10Y", name:"한국 국채 10년", price:100000, yield:3.02, coupon:2.90, maturity:"2036-06", duration:7.8, change:0, unit:"KRW" },
    { id:"US2Y", symbol:"US2Y", name:"미국 국채 2년", price:100000, yield:3.84, coupon:3.50, maturity:"2028-08", duration:1.9, change:0, unit:"KRW" },
    { id:"US10Y", symbol:"US10Y", name:"미국 국채 10년", price:100000, yield:4.17, coupon:4.00, maturity:"2036-08", duration:8.1, change:0, unit:"KRW" },
    { id:"US30Y", symbol:"US30Y", name:"미국 국채 30년", price:100000, yield:4.52, coupon:4.25, maturity:"2056-08", duration:15.4, change:0, unit:"KRW" }
  ],
  crypto: [
    { id:"BTC", symbol:"BTC", name:"Bitcoin", price:162500000, change:2.3, unit:"KRW" },
    { id:"ETH", symbol:"ETH", name:"Ethereum", price:6840000, change:1.5, unit:"KRW" },
    { id:"SOL", symbol:"SOL", name:"Solana", price:328000, change:-0.8, unit:"KRW" },
    { id:"XRP", symbol:"XRP", name:"XRP", price:4120, change:0.7, unit:"KRW" }
  ]
};
