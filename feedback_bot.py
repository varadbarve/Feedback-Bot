import asyncio
import os
from playwright.async_api import async_playwright
from dotenv import load_dotenv

load_dotenv()

USERNAME = os.getenv("SRM_USERNAME", "")
PASSWORD = os.getenv("SRM_PASSWORD", "")

LOGIN_URL = "https://sp.srmist.edu.in/srmiststudentportal/students/loginManager/youLogin.jsp"
FEEDBACK_URL = "https://sp.srmist.edu.in/srmiststudentportal/students/report/studentFeedback.jsp"

RATING = "EXCELLENT"  # matched case-insensitively against dropdown options


async def find_best_rating_match(select_el, target_rating):
    """Find the best matching option for the target rating (case-insensitive)."""
    options = await select_el.locator("option").all()
    for opt in options:
        text = (await opt.text_content()).strip()
        if target_rating.lower() in text.lower():
            return text  # return the exact label as it appears on the page
    return None


async def fill_feedback_for_course(page, course_index):
    try:
        await page.goto(FEEDBACK_URL, wait_until="networkidle", timeout=30000)
    except Exception as e:
        print(f"  [!] Failed to load feedback page: {e}")
        return False

    # Pick the course by index
    course_dropdown = page.locator("select").nth(0)
    options = await course_dropdown.locator("option").all()
    if course_index >= len(options) - 1:  # skip the first blank/SELECT option
        return False

    course_text = (await options[course_index + 1].text_content()).strip()
    print(f"\n{'='*50}")
    print(f"Course {course_index + 1}: {course_text}")
    print(f"{'='*50}")

    await course_dropdown.select_option(index=course_index + 1)
    await page.wait_for_timeout(1500)  # wait for dependent dropdowns to populate

    # Select teacher (pick first available if more than the default)
    teacher_dropdown = page.locator("select").nth(1)
    teacher_options = await teacher_dropdown.locator("option").all()
    if len(teacher_options) > 1:
        teacher_text = (await teacher_options[1].text_content()).strip()
        await teacher_dropdown.select_option(index=1)
        print(f"  Teacher: {teacher_text}")
        await page.wait_for_timeout(500)
    else:
        print("  [!] No teacher found for this course, skipping.")
        return True  # not an error, just nothing to fill

    # Fill all feedback question dropdowns with RATING
    all_selects = await page.locator("select").all()
    filled_count = 0
    skipped_count = 0
    for sel in all_selects[2:]:  # skip course and teacher dropdowns
        try:
            match = await find_best_rating_match(sel, RATING)
            if match:
                await sel.select_option(label=match)
                filled_count += 1
            else:
                skipped_count += 1
        except Exception:
            skipped_count += 1

    print(f"  Filled {filled_count} rating fields (skipped {skipped_count})")

    if filled_count == 0:
        print("  [!] No rating fields were filled — skipping submission.")
        return True

    # Handle confirmation dialogs (accept any alert/confirm that pops up)
    page.on("dialog", lambda dialog: asyncio.ensure_future(dialog.accept()))

    # Submit — try multiple common selectors
    submit_btn = None
    for selector in [
        'input[type="submit"]',
        'button[type="submit"]',
        'input[value="Submit"]',
        'button:has-text("Submit")',
        'a:has-text("Submit")',
        'input[type="button"][value="Submit"]',
    ]:
        loc = page.locator(selector).first
        if await loc.count() > 0:
            submit_btn = loc
            break

    if submit_btn is None:
        print("  [!] Could not find submit button — skipping this course.")
        return True

    try:
        await submit_btn.click()
        await page.wait_for_load_state("networkidle", timeout=15000)
        await page.wait_for_timeout(1000)
        print(f"  ✓ Feedback submitted successfully!")
    except Exception as e:
        print(f"  [!] Error during submission: {e}")

    return True


async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        page = await browser.new_page()

        # --- Auto-fill credentials, manual CAPTCHA ---
        await page.goto(LOGIN_URL)
        await page.wait_for_load_state("networkidle")

        # Auto-fill username and password
        try:
            await page.fill('#username', USERNAME)
            await page.fill('#password', PASSWORD)
            print("Credentials auto-filled!")
        except Exception:
            print("[!] Could not auto-fill credentials — please type them manually.")

        print("=" * 50)
        print("Solve the CAPTCHA and click Login in the browser.")
        print("After you're logged in, press ENTER here to continue...")
        print("=" * 50)
        await asyncio.get_event_loop().run_in_executor(None, input)

        # Verify login by navigating to feedback page
        try:
            await page.goto(FEEDBACK_URL, wait_until="networkidle", timeout=30000)
        except Exception as e:
            print(f"[!] Failed to navigate to feedback page: {e}")
            await browser.close()
            return

        # Check if we got redirected back to login (means login failed/expired)
        if "login" in page.url.lower():
            print("[!] It looks like you're not logged in. Please try again.")
            await browser.close()
            return

        print("Login verified! Starting feedback automation...\n")

        # Count courses
        course_dropdown = page.locator("select").nth(0)
        options = await course_dropdown.locator("option").all()
        num_courses = len(options) - 1  # subtract the blank default option
        print(f"Found {num_courses} course(s) to fill feedback for.")

        if num_courses <= 0:
            print("[!] No courses found. The page structure may have changed.")
            await browser.close()
            return

        for i in range(num_courses):
            success = await fill_feedback_for_course(page, i)
            if not success:
                print(f"\n[!] Stopped at course index {i}.")
                break

        print(f"\n{'='*50}")
        print("All done! You can close the browser.")
        print(f"{'='*50}")
        await browser.close()


asyncio.run(run())