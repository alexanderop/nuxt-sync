import { test, expect } from '@playwright/test'

test.describe('Todo App', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    // Wait for WebSocket connection and ready status
    await expect(page.locator('.status')).toHaveText('ready', { timeout: 15_000 })
  })

  test('displays the page title and subtitle', async ({ page }) => {
    await expect(page.locator('h1')).toHaveText('nuxt-sync demo')
    await expect(page.locator('.subtitle')).toContainText('Real-time collaborative todos')
  })

  test('shows ready status after connection', async ({ page }) => {
    const status = page.locator('.status')
    await expect(status).toHaveText('ready')
    await expect(status).toHaveClass(/ready/)
  })

  test('shows empty state message when no todos', async ({ page }) => {
    // Clean up any existing todos
    const deleteButtons = page.locator('.delete-btn')
    const count = await deleteButtons.count()
    for (let i = count - 1; i >= 0; i--) {
      await deleteButtons.nth(i).click()
    }

    await expect(page.locator('.empty')).toHaveText('No todos yet. Add one above!')
  })

  test('can add a new todo', async ({ page }) => {
    const input = page.locator('.add-form input')
    const addButton = page.locator('.add-form button')

    await input.fill('Buy groceries')
    await addButton.click()

    // Verify the todo appears in the list
    await expect(page.locator('.todo-title').last()).toHaveText('Buy groceries')

    // Input should be cleared after adding
    await expect(input).toHaveValue('')
  })

  test('add button is disabled when input is empty', async ({ page }) => {
    const addButton = page.locator('.add-form button')
    await expect(addButton).toBeDisabled()
  })

  test('can add a todo by pressing Enter', async ({ page }) => {
    const input = page.locator('.add-form input')

    await input.fill('Press enter todo')
    await input.press('Enter')

    await expect(page.locator('.todo-title').last()).toHaveText('Press enter todo')
    await expect(input).toHaveValue('')
  })

  test('can toggle a todo as done', async ({ page }) => {
    const input = page.locator('.add-form input')
    await input.fill('Toggle me')
    await input.press('Enter')

    // Find the newly added todo
    const todoItem = page.locator('.todo-item').last()
    const checkbox = todoItem.locator('input[type="checkbox"]')

    // Should start unchecked
    await expect(checkbox).not.toBeChecked()
    await expect(todoItem).not.toHaveClass(/done/)

    // Toggle done
    await checkbox.click()

    // Should now be checked
    await expect(checkbox).toBeChecked()
    await expect(todoItem).toHaveClass(/done/)
  })

  test('can delete a todo', async ({ page }) => {
    const input = page.locator('.add-form input')
    await input.fill('Delete me')
    await input.press('Enter')

    // Wait for the todo to appear
    await expect(page.locator('.todo-title').last()).toHaveText('Delete me')

    const initialCount = await page.locator('.todo-item').count()

    // Click delete on the last todo
    await page.locator('.todo-item').last().locator('.delete-btn').click()

    // Should have one fewer item
    await expect(page.locator('.todo-item')).toHaveCount(initialCount - 1)
  })

  test('shows correct item count in footer', async ({ page }) => {
    // Clean up existing todos
    const deleteButtons = page.locator('.delete-btn')
    let count = await deleteButtons.count()
    for (let i = count - 1; i >= 0; i--) {
      await deleteButtons.nth(i).click()
    }

    const input = page.locator('.add-form input')

    // Add first item
    await input.fill('Item 1')
    await input.press('Enter')
    await expect(page.locator('footer p').first()).toHaveText('1 item')

    // Add second item
    await input.fill('Item 2')
    await input.press('Enter')
    await expect(page.locator('footer p').first()).toHaveText('2 items')
  })

  test('does not add empty or whitespace-only todos', async ({ page }) => {
    const initialCount = await page.locator('.todo-item').count()

    const input = page.locator('.add-form input')

    // Try empty
    await input.fill('')
    await input.press('Enter')
    await expect(page.locator('.todo-item')).toHaveCount(initialCount)

    // Try whitespace
    await input.fill('   ')
    await input.press('Enter')
    await expect(page.locator('.todo-item')).toHaveCount(initialCount)
  })

  test('footer shows tech stack info', async ({ page }) => {
    await expect(page.locator('.tech')).toContainText('LWW-CRDT')
    await expect(page.locator('.tech')).toContainText('Nitro WebSocket')
    await expect(page.locator('.tech')).toContainText('Vue Reactivity')
  })
})

test.describe('Multi-tab sync', () => {
  test('syncs new todos between tabs', async ({ page, context }) => {
    await page.goto('/')
    await expect(page.locator('.status')).toHaveText('ready', { timeout: 15_000 })

    // Open a second tab
    const page2 = await context.newPage()
    await page2.goto('/')
    await expect(page2.locator('.status')).toHaveText('ready', { timeout: 15_000 })

    // Add a todo from the first tab
    const input = page.locator('.add-form input')
    await input.fill('Synced todo')
    await input.press('Enter')

    // It should appear in the second tab
    await expect(page2.locator('.todo-title').last()).toHaveText('Synced todo', { timeout: 5_000 })

    await page2.close()
  })

  test('syncs todo deletion between tabs', async ({ page, context }) => {
    await page.goto('/')
    await expect(page.locator('.status')).toHaveText('ready', { timeout: 15_000 })

    // Add a todo
    const input = page.locator('.add-form input')
    await input.fill('Delete sync test')
    await input.press('Enter')
    await expect(page.locator('.todo-title').last()).toHaveText('Delete sync test')

    // Open second tab
    const page2 = await context.newPage()
    await page2.goto('/')
    await expect(page2.locator('.status')).toHaveText('ready', { timeout: 15_000 })
    await expect(page2.locator('.todo-title').last()).toHaveText('Delete sync test', { timeout: 5_000 })

    const countBefore = await page2.locator('.todo-item').count()

    // Delete from first tab
    await page.locator('.todo-item').last().locator('.delete-btn').click()

    // Should disappear from second tab
    await expect(page2.locator('.todo-item')).toHaveCount(countBefore - 1, { timeout: 5_000 })

    await page2.close()
  })

  test('syncs todo toggle between tabs', async ({ page, context }) => {
    await page.goto('/')
    await expect(page.locator('.status')).toHaveText('ready', { timeout: 15_000 })

    // Add a todo
    const input = page.locator('.add-form input')
    await input.fill('Toggle sync test')
    await input.press('Enter')

    // Open second tab
    const page2 = await context.newPage()
    await page2.goto('/')
    await expect(page2.locator('.status')).toHaveText('ready', { timeout: 15_000 })
    await expect(page2.locator('.todo-title').last()).toHaveText('Toggle sync test', { timeout: 5_000 })

    // Toggle from first tab
    await page.locator('.todo-item').last().locator('input[type="checkbox"]').click()

    // Should be checked in second tab
    await expect(page2.locator('.todo-item').last().locator('input[type="checkbox"]')).toBeChecked({ timeout: 5_000 })

    await page2.close()
  })
})
