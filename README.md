# 好日生活購物網站與管理後台

Shopping｜購物網站

以 Vue 3、Vite、Bootstrap RWD、Express 與 SQLite 建置。前台包含品牌首頁、商品目錄、會員、購物車、結帳與訂單查詢；後台提供輪播、商品庫存、銷售追蹤、成員及角色權限管理。登入狀態使用伺服器 session，瀏覽器不保存授權資料。

## 開發環境

```sh
npm install
npm run dev
```

`npm run dev` 會同時啟動 Vite（預設 `http://localhost:5173`）與 API（`http://127.0.0.1:3000`）。開發資料庫與圖片存放於 `data/`，不會提交至版本控制。

商店網址為 `http://localhost:5173/shop`，會員登入/註冊位於 `/account`，購物車位於 `/cart`。後台入口為 `/admin`；只有具備後台存取權的帳號可以登入。

初次啟動會建立示範帳號，所有帳號共用開發密碼 `GooddayDemo2026!`：

| 帳號 | 初始角色 |
|---|---|
| `superadmin` | 超級管理員 |
| `admin` | 管理員 |
| `manager` | 經理 |
| `editor` | 編輯 |
| `guest` | 訪客 |

可設定 `SEED_PASSWORD` 覆寫新資料庫的示範帳號密碼。密碼只在建立使用者時寫入 bcrypt 雜湊；若要重設既有帳號，需更新資料庫中的密碼雜湊。

訪客可以瀏覽商品、使用購物車；結帳前必須先註冊或登入。建立訂單後需在頁面按「模擬完成付款」完成測試付款；此測試流程不會實際扣款，也不等同正式金流。正式上線前需另行串接並設定金流服務商。

具備 `products:manage` 權限的後台管理員可新增/編輯商品、上傳圖片、調整庫存與上下架；具備 `sales:view` 權限者可檢視已付款營收、售出件數、熱銷排行與近期訂單。

## 權限模型

- 角色直接勾選權限，不使用角色繼承。
- 階級數字越大代表層級越高；操作者只能管理層級數字嚴格小於自己的角色與成員，同級不可互相管理。
- 階級不會自動授予功能。進入後台必須另外擁有 `admin:access`；預設訪客角色沒有此權限，前端路由與所有後台 API 都會拒絕沒有此權限的帳號。
- 後端會驗證每次權限與成員異動；前端隱藏控制項不作為授權依據。
- 成員眼睛按鈕使用 session 切換唯讀視角；修改資料必須先結束預覽。
- 商品管理與銷售追蹤分別由 `products:manage`、`sales:view` 權限控制。

## API 與部署

`npm run build` 建置前端，`npm start` 啟動 API。部署時需由同一個網域提供前端與 `/api`、`/uploads` 路徑，或自行設定反向代理。

### GitHub Pages 前端展示

推送至 `main` 後，GitHub Actions 會自動建置並部署靜態前端。第一次部署前，請到 repository 的 **Settings → Pages → Build and deployment**，將 **Source** 設為 **GitHub Actions**。部署完成後，可從 workflow 的 deployment link 開啟網站，網址格式為 `https://rex-yeh.github.io/Shopping/`。

GitHub Pages 展示模式使用靜態示範商品與輪播，購物車只在目前頁面記憶體中操作；會員、管理後台、API、訂單與付款不會啟用。此展示站不連接正式資料庫，也不提供真實交易功能。

正式環境至少設定：

```sh
NODE_ENV=production
SESSION_SECRET=<long-random-secret>
DATA_DIRECTORY=<persistent-data-directory>
SEED_PASSWORD=<initial-account-password>
```

正式環境使用 HTTPS，以啟用安全 session cookie。`SEED_PASSWORD` 僅用於初始化尚無帳號的資料庫；不要使用開發預設密碼。

圖片上傳支援 JPG、PNG、WebP 與 GIF，限制 5 MB；檔案存放於 `DATA_DIRECTORY/uploads`。SQLite 資料庫為 `DATA_DIRECTORY/goodday.sqlite`。

## 驗證

```sh
npm run build
npm audit
```
