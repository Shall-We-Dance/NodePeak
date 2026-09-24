"""Browser regression checks for independent chart windows and responsive controls."""
import sys
from playwright.sync_api import sync_playwright

def main():
    with sync_playwright() as p:
        browser=p.chromium.launch(args=['--no-sandbox'])
        page=browser.new_page(viewport={'width':1440,'height':1000})
        page.add_init_script('window.setInterval=()=>0;')
        errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:9100',wait_until='networkidle')
        page.wait_for_function('()=>state.history && state.networkHistory.data && state.containerHistory.data')
        page.locator('#network-range-buttons [data-section-range="604800"]').click()
        page.wait_for_function('()=>!state.networkHistory.loading && state.networkHistory.data')
        assert page.evaluate('state.range===3600 && state.containerHistory.range===3600 && state.networkHistory.range===604800')
        page.locator('#container-range-buttons [data-section-range="21600"]').click()
        page.wait_for_function('()=>!state.containerHistory.loading && state.containerHistory.data')
        page.locator('#range-buttons [data-range="900"]').click()
        page.wait_for_function('()=>state.range===900')
        assert page.evaluate('state.networkHistory.range===604800 && state.containerHistory.range===21600')
        assert page.evaluate("Math.round((state.charts.get('network-chart').getOption().xAxis[0].max-state.charts.get('network-chart').getOption().xAxis[0].min)/1000)===604800")
        assert page.evaluate("Math.round((state.charts.get('container-chart').getOption().xAxis[0].max-state.charts.get('container-chart').getOption().xAxis[0].min)/1000)===21600")
        page.locator('#container-metric').select_option('memory')
        assert page.evaluate('state.containerHistory.range===21600')
        page.locator('#network-range-buttons [data-section-range="custom"]').click()
        page.locator('#network-range-start').fill('2026-01-02T00:00')
        page.locator('#network-range-end').fill('2026-01-01T00:00')
        page.locator('#network-custom-range button').click()
        assert page.locator('#network-range-error').inner_text()
        page.locator('#network-range-start').fill('2026-01-01T00:00')
        page.locator('#network-range-end').fill('2026-01-03T00:00')
        page.locator('#network-custom-range button').click()
        page.wait_for_function('()=>!state.networkHistory.loading && state.networkHistory.custom')
        assert page.evaluate('state.networkHistory.window.end-state.networkHistory.window.start===172800 && state.containerHistory.range===21600')
        for language in ['en','zh','ko','es','ja']:
            page.evaluate('(lang)=>I18n.setLanguage(lang)',language)
            page.set_viewport_size({'width':320,'height':850})
            assert not page.evaluate('document.documentElement.scrollWidth>innerWidth'),language
        assert not errors,errors
        browser.close()
    print('Passed: independent network/container/top ranges, chart axes, metric changes, custom validation, five-language mobile controls.')

if __name__=='__main__':main()
