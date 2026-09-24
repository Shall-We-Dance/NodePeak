"""Browser regression checks for independent chart windows and responsive controls."""
import sys
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

def check_page(page):
    page.add_init_script('window.setInterval=()=>0;')
    page.reload(wait_until='networkidle')
    page.evaluate("I18n.setLanguage('en')")
    page.set_viewport_size({'width':1440,'height':1000})
    page.wait_for_function('()=>state.history && state.networkHistory.data && state.containerHistory.data && state.powerHistory.data')
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
    # Controlled events verify date boundaries, pagination, filtering and refresh retention.
    now=page.evaluate('Math.floor(Date.now()/1000)')
    fixture=[{'ts':now-1800-i*3600,'kind':'power_failure' if i%2 else 'power_restored','severity':'warning','message':'Synthetic event','source':'Test fixture'} for i in range(40)]
    fixture.append({'ts':now-10*86400,'kind':'power_failure','severity':'warning','message':'Outside selected window','source':'Test fixture'})
    def events_route(route):
        q=parse_qs(urlparse(route.request.url).query)
        rows=[e for e in fixture if e['ts']<int(q['before'][0]) and (not q.get('kind') or e['kind']==q['kind'][0])]
        route.fulfill(json={'events':rows[:int(q['limit'][0])]})
    page.route('**/api/events?*',events_route)
    assert page.evaluate('state.powerHistory.range===86400')
    assert not page.locator('.sensor-details').evaluate('(e)=>e.open')
    page.locator('#power-range-buttons [data-section-range="604800"]').click()
    page.wait_for_function('()=>!state.powerHistory.loading && state.powerHistory.data')
    assert page.evaluate('state.range===900 && state.containerHistory.range===21600 && state.powerHistory.range===604800')
    assert page.evaluate("state.charts.get('health-chart').getOption().xAxis[0].max-state.charts.get('health-chart').getOption().xAxis[0].min===604800000")
    page.wait_for_function('()=>!document.getElementById("more-events").disabled')
    assert page.evaluate('state.events.length===30')
    page.locator('#more-events').click()
    page.wait_for_function('()=>!document.getElementById("more-events").disabled && state.events.length===40')
    page.evaluate('()=>loadEvents()')
    assert page.evaluate('state.events.length===40')
    page.locator('#event-filter').select_option('power_failure')
    page.wait_for_function('()=>!document.getElementById("more-events").disabled')
    assert page.evaluate('state.events.length===20 && state.events.every(e=>e.kind==="power_failure")')
    page.locator('#power-range-buttons [data-section-range="900"]').click()
    page.wait_for_function('()=>!state.powerHistory.loading && !document.getElementById("more-events").disabled')
    assert page.evaluate('state.events.every(e=>e.ts>=state.powerHistory.window.start && e.ts<=state.powerHistory.window.end)')
    assert page.evaluate('state.events.length===0')
    page.locator('.sensor-details > summary').click()
    page.evaluate('renderPower()')
    assert page.locator('.sensor-details').evaluate('(e)=>e.open')
    for language in ['en','zh','ko','es','ja']:
        page.evaluate('(lang)=>I18n.setLanguage(lang)',language)
        page.set_viewport_size({'width':320,'height':850})
        assert not page.evaluate('document.documentElement.scrollWidth>innerWidth'),language
    page.unroute('**/api/events?*',events_route)


def main():
    with sync_playwright() as p:
        browser=p.chromium.launch(args=['--no-sandbox'])
        page=browser.new_page(viewport={'width':1440,'height':1000})
        page.add_init_script('window.setInterval=()=>0;')
        errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:9100',wait_until='networkidle')
        check_page(page)
        assert not errors,errors
        browser.close()
    print('Passed: independent power/network/container/top ranges, chart axes, metric changes, custom validation, five-language mobile controls.')

if __name__=='__main__':main()
