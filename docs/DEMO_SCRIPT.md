# Demo video script (2-3 minutes)

Record the screen at http://localhost:5180 (sign in as any demo persona, password Demo123!). Say "synthetic demo data" once, early.

| Time | Screen | Say |
|---|---|---|
| 0:00 | Home | "Lives Group's MDM requests and demand forecasts are manual and email-driven. We built a portal for requests, and a forecaster that tells planners how far to trust each number." |
| 0:20 | New request, type a near-duplicate customer name | "Incomplete or duplicate requests never reach an approver." (Check this works before recording.) |
| 0:45 | Requests, open one | "Everyone sees who it is waiting on, with reminders and a hash-chained audit trail." |
| 1:05 | Regional view, top | "Volume means confirmed orders only. Growth is year-on-year units. Enquiries and MDM requests are excluded." |
| 1:25 | Country x product grid | "Product C volumes are tiny, so we flag them as indicative instead of showing +118% as fact." |
| 1:45 | Chart + scorecard | "Orders come from the database. The forecaster back-tests on months it never saw: 11.7% error against 12.4% for the 6-month average. It is only a modest gain on this data, and we say so. The guardrail keeps the average unless a model clearly wins." |
| 2:10 | AI outlook | "Claude writes the plain-English outlook and actions. Directions are fixed in code and every number is checked against the forecast. It cannot invent figures." |
| 2:35 | Forecast table | "Every series shows its method and confidence." |
| 2:50 | Close | "Not built in v1: live supply forecasting, because there is no inventory data; live AI calls, to keep the demo reliable." |

Before recording: `cd server && npm run dev`, `cd client && npm run dev`, confirm Regional view loads, upload to YouTube, paste the link into the summary.
