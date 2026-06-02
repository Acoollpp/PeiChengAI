import { test as setup } from "@playwright/test"
import { testApiKey } from "./config.ts"
import { logInWithKey } from "./utils/user"

const authFile = "playwright/.auth/user.json"

setup("authenticate", async ({ page }) => {
  await logInWithKey(page, testApiKey)
  await page.context().storageState({ path: authFile })
})
