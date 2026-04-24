import asyncio
import os
from playwright.async_api import async_playwright
from dotenv import load_dotenv

load_dotenv()

USERNAME = os.getenv("SRM_USERNAME", "")
PASSWORD = os.getenv("SRM_PASSWORD", "")

LOGIN_URL = "https://sp.srmist.edu.in/srmiststudentportal/students/loginManager/youLogin.jsp"

RATING = "EXCELLENT"  # matched case-insensitively against dropdown options


async def find_best_rating_match(select_el, target_rating):
    """Find the best matching option for the target rating (case-insensitive)."""
    options = await select_el.locator("option").all()
    for opt in options:
        text = (await opt.text_content()).strip()
        if target_rating.lower() in text.lower():
            return text  # return the exact label as it appears on the page
    return None


async def is_subject_dropdown(select_el):
    """Check if a select element looks like the subject/course dropdown."""
    options = await select_el.locator("option").all()
    if len(options) > 2:  # has multiple courses
        return True
    return False


async def fill_feedback_for_subject(page, subject_dropdown, subject_index):
    """Fill feedback for a single subject by selecting it from the dropdown."""
    options = await subject_dropdown.locator("option").all()

    # Get the subject text
    subject_text = (await options[subject_index].text_content()).strip()
    if not subject_text or subject_text.lower() in ["select", "--select--", "-- select --", ""]:
        return "skip"

    print(f"\n{'='*50}")
    print(f"Subject: {subject_text}")
    print(f"{'='*50}")

    # Select the subject
    try:
        await subject_dropdown.select_option(index=subject_index)
    except Exception as e:
        print(f"  [!] Could not select subject: {e}")
        return "skip"

    await page.wait_for_timeout(2000)  # wait for page to update

    # After selecting a subject, find all NEW select dropdowns on the page
    # (excluding the subject dropdown itself and any "Semester" textbox)
    all_selects = await page.locator("select").all()

    # Identify which selects are rating dropdowns (not the subject dropdown)
    filled_count = 0
    skipped_count = 0
    for sel in all_selects:
        try:
            # Skip if this is the subject dropdown itself
            sel_options = await sel.locator("option").all()
            option_texts = []
            for opt in sel_options:
                option_texts.append((await opt.text_content()).strip().lower())

            # Skip dropdowns that look like subject/course selectors or semester selectors
            if any("select" in t for t in option_texts[:1]):  # first option is "Select..."
                # Check if this is a rating dropdown by looking for rating keywords
                has_rating = any(
                    keyword in " ".join(option_texts)
                    for keyword in ["excellent", "good", "average", "poor", "very good", "satisfactory"]
                )
                if not has_rating:
                    skipped_count += 1
                    continue

            # Try to set the rating
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
        print("  [!] No rating fields were filled — may be already submitted. Skipping.")
        return "skip"

    # Handle confirmation dialogs (accept any alert/confirm that pops up)
    page.on("dialog", lambda dialog: asyncio.ensure_future(dialog.accept()))

    # Submit — try multiple common selectors
    submit_btn = None
    for selector in [
        'input[type="submit"]',
        'button[type="submit"]',
        'input[value="Submit"]',
        'input[value="SUBMIT"]',
        'input[value="submit"]',
        'button:has-text("Submit")',
        'button:has-text("SUBMIT")',
        'a:has-text("Submit")',
        'input[type="button"][value="Submit"]',
        'input[type="button"][value="SUBMIT"]',
        'button',  # any button at all
        'input[type="button"]',
    ]:
        loc = page.locator(selector).first
        if await loc.count() > 0:
            submit_btn = loc
            btn_text = await loc.text_content() or await loc.get_attribute("value") or selector
            print(f"  Found submit button: '{btn_text.strip()}' ({selector})")
            break

    if submit_btn is None:
        # Debug: print all clickable elements
        print("  [DEBUG] All buttons/inputs on page:")
        for tag in ["button", "input[type='button']", "input[type='submit']", "a.btn", "[role='button']"]:
            els = await page.locator(tag).all()
            for el in els:
                txt = (await el.text_content() or "").strip()
                val = await el.get_attribute("value") or ""
                print(f"    <{tag}> text='{txt}' value='{val}'")
        print("  [!] Could not find submit button — skipping.")
        return "skip"

    try:
        await submit_btn.click()
        await page.wait_for_timeout(2000)
        print(f"  ✓ Feedback submitted successfully!")
    except Exception as e:
        print(f"  [!] Error during submission: {e}")

    # After submission, the page may show a Semester textbox or reload.
    # Wait a moment then continue to the next subject — don't touch anything else.
    await page.wait_for_timeout(1000)

    return "done"


async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        page = await browser.new_page()

        # --- Auto-fill credentials, manual CAPTCHA ---
        await page.goto(LOGIN_URL)
        await page.wait_for_load_state("networkidle")

        # Auto-fill username and password
        try:
            # Remove maxlength=6 restriction on the NetID field
            await page.evaluate('document.querySelector("#username").removeAttribute("maxlength")')
            await page.fill('#username', USERNAME)
            await page.fill('#password', PASSWORD)
            print("Credentials auto-filled!")
        except Exception:
            print("[!] Could not auto-fill credentials — please type them manually.")

        print("=" * 50)
        print("Solve the CAPTCHA and click Login in the browser.")
        print("Once you're logged in, press ENTER here...")
        print("=" * 50)
        await asyncio.get_event_loop().run_in_executor(None, input)

        # Check we're not still on login
        current_url = page.url
        print(f"Current URL: {current_url}")
        if "login" in current_url.lower():
            print("[!] It looks like you're still on the login page. Please try again.")
            await browser.close()
            return

        print("Logged in! Looking for 'End Sem feedback' link...")
        await page.wait_for_timeout(2000)

        # Click the "End Sem feedback" link on the dashboard
        feedback_link = None
        for selector in [
            'a:has-text("End Sem")',
            'a:has-text("end sem")',
            'a:has-text("Feedback")',
            'a:has-text("feedback")',
        ]:
            loc = page.locator(selector).first
            if await loc.count() > 0:
                feedback_link = loc
                print(f"  Found link with selector: {selector}")
                break

        if feedback_link is None:
            print("\n[!] Could not find 'End Sem feedback' link automatically.")
            print("Please click it manually in the browser, then press ENTER here...")
            await asyncio.get_event_loop().run_in_executor(None, input)
        else:
            await feedback_link.click()
            await page.wait_for_load_state("networkidle", timeout=15000)
            await page.wait_for_timeout(3000)

        print(f"Feedback page URL: {page.url}")
        print("Starting feedback automation...\n")

        # Wait for page content to fully load
        await page.wait_for_timeout(2000)

        # Find the subject/course dropdown
        all_selects = await page.locator("select").all()
        print(f"Found {len(all_selects)} select element(s) on page")

        if len(all_selects) == 0:
            print("[!] No select elements found. The page structure may have changed.")
            await browser.close()
            return

        # The first dropdown should be the subject selector
        subject_dropdown = page.locator("select").nth(0)
        options = await subject_dropdown.locator("option").all()
        print(f"Subject dropdown has {len(options)} option(s):")
        for idx, opt in enumerate(options):
            text = (await opt.text_content()).strip()
            print(f"  [{idx}] {text}")

        # Loop through each subject option
        submitted = 0
        skipped = 0
        for i in range(len(options)):
            opt_text = (await (await subject_dropdown.locator("option").all())[i].text_content()).strip()

            # Skip blank/placeholder options
            if not opt_text or opt_text.lower() in ["select", "--select--", "-- select --", "select subject"]:
                continue

            result = await fill_feedback_for_subject(page, subject_dropdown, i)
            if result == "done":
                submitted += 1
                # Re-fetch the dropdown since page may have updated after submission
                subject_dropdown = page.locator("select").nth(0)
            elif result == "skip":
                skipped += 1
                # Re-fetch the dropdown
                subject_dropdown = page.locator("select").nth(0)

        print(f"\n{'='*50}")
        print(f"All done! Submitted: {submitted}, Skipped: {skipped}")
        print(f"{'='*50}")
        await browser.close()


asyncio.run(run())