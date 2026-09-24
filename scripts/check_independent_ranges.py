"""Browser regression checks for independent chart windows and responsive controls."""
import sys
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

def show_disk_comparison(page):
    """Replace only browser state with a deterministic deleted-file example."""
    page.evaluate("""()=>{
        window.originalComparisonLive=state.live;
        const gib=1024**3;
        state.live={...state.live,disks:[{mount:'/data',device:'/dev/example',fstype:'ext4',total:1000*gib,used:400*gib,free:550*gib}],
          disk_scan:{state:'complete',finished_at:Math.floor(Date.now()/1000)-7200,roots:['/data'],files:12345,
            users:{'1000':{name:'alice',roots:{'/data':600*gib}},'1001':{name:'bob',roots:{'/data':150*gib}}}},scan_progress:null};
        renderDisks();
    }""")

def check_page(page):
    page.add_init_script('window.setInterval=()=>0;')
    page.reload(wait_until='networkidle')
    page.evaluate("I18n.setLanguage('en')")
    page.set_viewport_size({'width':1440,'height':1000})
    page.wait_for_function('()=>state.history && state.networkHistory.data && state.containerHistory.data && state.powerHistory.data')
    assert page.locator('.twin-drive .drive-glyph').count()==page.evaluate('state.hardware.disks.length')
    page.locator('.twin-drive').first.click()
    assert page.locator('.twin-drive').first.get_attribute('aria-pressed')=='true'
    page.emulate_media(reduced_motion='reduce')
    page.locator('.twin-drive').last.focus()
    page.keyboard.press('Enter')
    assert page.locator('.twin-drive').last.get_attribute('aria-pressed')=='true'
    assert page.locator('#twin-inspector').evaluate('(e)=>e.getAnimations().length===0')
    assert page.locator('.twin-drive').first.evaluate('(e)=>getComputedStyle(e).transitionDuration')=='0s'
    page.emulate_media(reduced_motion='no-preference')
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
    show_disk_comparison(page)
    card=page.locator('[data-disk="/data"]')
    assert card.locator('.disk-snapshot').count()==1
    live=card.locator('.disk-capacity-bar').bounding_box()
    previous=card.locator('.disk-snapshot-bar').bounding_box()
    assert abs(live['width']-previous['width'])<1
    assert previous['y']>live['y']
    for selector,share in [('.disk-capacity-bar .unattributed-segment',.4),('[data-snapshot-owner="1000"]',.6),('[data-snapshot-owner="1001"]',.15),('.disk-snapshot-bar .snapshot-remainder',.25)]:
        assert abs(card.locator(selector).bounding_box()['width']/live['width']-share)<.002,selector
    assert 'alice' in card.locator('.disk-snapshot-bar').get_attribute('aria-label')
    assert 'Last scan:' in card.locator('.disk-snapshot-heading').inner_text()
    # User names and translations must wrap inside the card, even on small screens.
    page.evaluate("state.live.disk_scan.users['1000'].name='long_username_'.repeat(8);renderDisks()")
    for language in ['en','zh','ko','es','ja']:
        page.evaluate('(lang)=>I18n.setLanguage(lang)',language)
        page.set_viewport_size({'width':320,'height':850})
        assert not page.evaluate('document.documentElement.scrollWidth>innerWidth'),language
        assert card.locator('.disk-snapshot').evaluate('(e)=>e.scrollWidth<=e.clientWidth'),language
        assert card.locator('.disk-snapshot-owner').first.evaluate('(e)=>e.scrollWidth<=e.clientWidth'),language
    page.evaluate('state.live=window.originalComparisonLive;delete window.originalComparisonLive;renderDisks()')
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
