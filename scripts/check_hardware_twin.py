#!/usr/bin/env python3
"""Verify the twin against a live API, plus browser-only 1/2/4-socket fixtures."""
import sys
from playwright.sync_api import sync_playwright, expect


def main():
    url=sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:9100'
    with sync_playwright() as p:
        browser=p.chromium.launch(args=['--no-sandbox'])
        page=browser.new_page(viewport={'width':1512,'height':1100})
        page.add_init_script('window.setInterval=()=>0;')
        errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto(url,wait_until='networkidle')
        page.wait_for_function('() => state.hardware?.collected_at')
        assert page.locator('#hardware').count() == 1
        page.locator('a[href="#hardware"]').click()
        expect(page.locator('.hardware-twin')).to_be_visible()
        contacts=page.locator('.twin-installed .twin-dimm-stick').first
        if contacts.count():
            assert contacts.evaluate("(e)=>{const s=getComputedStyle(e,':before');return parseFloat(s.height)>parseFloat(s.width)*5}")
        assert page.locator('details.hardware-specifications').evaluate('(e)=>!e.open')
        actual=page.evaluate('({cpu:HardwareTwin.prepare(state.hardware).cpuStats,memory:HardwareTwin.prepare(state.hardware).memoryStats})')
        expect(page.locator('.twin-cpu')).to_have_count(actual['cpu']['total'])
        expect(page.locator('.twin-dimm')).to_have_count(actual['memory']['total'])
        if actual['memory']['empty']:
            empty=page.locator('.twin-dimm.twin-empty').first
            empty.click()
            expect(empty).to_have_attribute('aria-pressed','true')
            expect(page.locator('#twin-inspector')).to_contain_text('This slot is reported as unoccupied.')
            selected=empty.get_attribute('data-twin-part')
            page.evaluate('HardwareUI.render(state.hardware,{esc,bytes,date})')
            expect(page.locator(f'[data-twin-part="{selected}"]')).to_be_focused()
            expect(page.locator(f'[data-twin-part="{selected}"]')).to_have_attribute('aria-pressed','true')
        # Details remain available, but do not overwhelm the diagram by default.
        assert page.locator('[data-hardware-key="specifications"]').evaluate('(e)=>!e.open')
        page.locator('[data-hardware-key="specifications"] > summary').click()
        page.locator('[data-hardware-key="cpu-extra"] > summary').click()
        page.evaluate('HardwareUI.render(state.hardware,{esc,bytes,date})')
        assert page.locator('[data-hardware-key="cpu-extra"]').evaluate('(e)=>e.open')
        page.locator('[data-hardware-key="specifications"] > summary').click()
        # Native buttons work with keyboard activation and preserve selection across translations.
        page.locator('[data-twin-part="bios"]').focus()
        page.keyboard.press('Enter')
        expect(page.locator('[data-twin-part="bios"]')).to_have_attribute('aria-pressed','true')
        for language in ['zh','ko','es','ja','en']:
            page.evaluate('(language)=>I18n.setLanguage(language)',language)
            expect(page.locator('[data-twin-part="bios"]')).to_have_attribute('aria-pressed','true')
            for width in [320,390,768,1024,1512]:
                page.set_viewport_size({'width':width,'height':1100})
                assert not page.evaluate('document.documentElement.scrollWidth>innerWidth'),(language,width)
                assert page.locator('.hardware-twin').evaluate('(e)=>e.scrollWidth<=e.clientWidth+2'),(language,width)
        for sockets,slots in [(1,4),(2,24),(4,48),(4,96)]:
            page.evaluate('''([sockets,slots])=>{
                window.realHardware??=state.hardware;
                state.hardware={collected_at:123,system:{distribution:'Example Linux'},board:{Model:'Example board'},cpu:{'Socket(s)':String(sockets)},
                  memory:{slots,total_bytes:64*1024**3},firmware_records:[
                    ...Array.from({length:sockets},(_,i)=>({type:4,fields:{'Socket Designation':'CPU'+(i+1),Version:'Example CPU',Status:i===sockets-1&&sockets>1?'Unpopulated':'Populated, Enabled'}})),
                    ...Array.from({length:slots},(_,i)=>({type:17,fields:{Locator:'DIMM '+(i+1),Size:i%2?'No Module Installed':'16 GB'}}))]};
                HardwareUI.render(state.hardware,{esc,bytes,date});
            }''',[sockets,slots])
            expect(page.locator('.twin-cpu')).to_have_count(sockets)
            expect(page.locator('.twin-dimm')).to_have_count(slots)
            expect(page.locator('.twin-dimm.twin-empty')).to_have_count(slots//2)
            if sockets>1:
                expect(page.locator('.twin-cpu.twin-empty')).to_have_count(1)
            for width in [320,1512]:
                page.set_viewport_size({'width':width,'height':1100})
                assert not page.evaluate('document.documentElement.scrollWidth>innerWidth'),(sockets,slots,width)
        page.evaluate('''()=>{
          state.hardware={collected_at:123,cpu:{'Socket(s)':'2'},memory:{total_bytes:64*1024**3},system:{distribution:'Example Linux'}};
          HardwareUI.render(state.hardware,{esc,bytes,date});
        }''')
        expect(page.locator('.twin-cpu')).to_have_count(2)
        expect(page.locator('.twin-dimm')).to_have_count(0)
        expect(page.locator('.hardware-twin')).to_contain_text('physical empty sockets are unknown')
        expect(page.locator('.hardware-twin')).to_contain_text('Total RAM does not reveal slot count')
        page.set_viewport_size({'width':390,'height':1000})
        page.locator('[data-twin-part="os"]').click()
        expect(page.locator('.twin-back')).to_be_in_viewport()
        page.locator('.twin-back').click()
        expect(page.locator('[data-twin-part="os"]')).to_be_focused()
        expect(page.locator('[data-twin-part="os"]')).to_be_in_viewport()
        page.evaluate('state.hardware=window.realHardware;HardwareUI.render(state.hardware,{esc,bytes,date})')
        page.reload(wait_until='networkidle')
        assert page.locator('#hardware').count() == 1
        assert not errors,errors
        browser.close()
    print('Passed: live inventory, empty-slot inspection, keyboard selection, state persistence, 1/2/4 CPUs, up to 96 DIMMs, unprivileged fallbacks and five-language mobile layouts.')


if __name__=='__main__':
    main()
