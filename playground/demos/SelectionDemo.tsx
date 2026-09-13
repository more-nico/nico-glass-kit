import { useState } from 'react';
import { GlassCheckbox, GlassLightGroup, GlassSwitch } from 'nico-glass-kit';
import type { DemoParams } from '../App';
import { DemoSection } from './DemoSection';
import { glassProps } from './demoProps';

export function SelectionDemo({ params }: { params: DemoParams }) {
  const [wifi, setWifi] = useState(true);
  const [bluetooth, setBluetooth] = useState(false);
  const [power, setPower] = useState(true);
  const [checks, setChecks] = useState({ motion: true, refract: true, sound: false });

  const toggle = (key: keyof typeof checks) =>
    setChecks((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <DemoSection
      index="06"
      title="GlassSwitch & GlassCheckbox"
      description="开关与勾选框：受控组件，键盘可聚焦，勾选态在玻璃内淡入"
      params={params}
    >
      <div className="demo-body">
        <div className="demo-group">
          <span className="demo-label">开关 Switch</span>
          <div className="demo-row">
            <GlassLightGroup>
              <span className="demo-toggle">
                <GlassSwitch checked={wifi} onChange={setWifi} {...glassProps(params)} />
                <span>无线局域网</span>
              </span>
              <span className="demo-toggle">
                <GlassSwitch checked={bluetooth} onChange={setBluetooth} size="sm" {...glassProps(params)} />
                <span>蓝牙 sm</span>
              </span>
              <span className="demo-toggle">
                <GlassSwitch checked={power} onChange={setPower} size="lg" {...glassProps(params)} />
                <span>大型 lg</span>
              </span>
              <span className="demo-toggle">
                <GlassSwitch checked disabled {...glassProps(params)} />
                <span>禁用</span>
              </span>
            </GlassLightGroup>
          </div>
        </div>
        <div className="demo-group">
          <span className="demo-label">勾选 Checkbox</span>
          <div className="demo-row">
            <GlassLightGroup>
              <span className="demo-toggle">
                <GlassCheckbox
                  checked={checks.motion}
                  onChange={() => toggle('motion')}
                  {...glassProps(params)}
                />
                <span>动态效果</span>
              </span>
              <span className="demo-toggle">
                <GlassCheckbox
                  checked={checks.refract}
                  onChange={() => toggle('refract')}
                  size="sm"
                  {...glassProps(params)}
                />
                <span>边缘折射 sm</span>
              </span>
              <span className="demo-toggle">
                <GlassCheckbox
                  checked={checks.sound}
                  onChange={() => toggle('sound')}
                  size="lg"
                  {...glassProps(params)}
                />
                <span>提示音 lg</span>
              </span>
              <span className="demo-toggle">
                <GlassCheckbox checked={false} disabled {...glassProps(params)} />
                <span>禁用</span>
              </span>
            </GlassLightGroup>
          </div>
        </div>
      </div>
    </DemoSection>
  );
}
