import { useState } from 'react';
import { GlassCheckbox, GlassLightGroup, GlassSwitch } from 'nico-glass-kit';
import type { DemoParams } from '../App';
import { useI18n } from '../i18n';
import { DemoSection } from './DemoSection';
import { glassProps } from './demoProps';

export function SelectionDemo({ params }: { params: DemoParams }) {
  const { t } = useI18n();
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
      description={t('selection.description')}
      params={params}
    >
      <div className="demo-body">
        <div className="demo-group">
          <span className="demo-label">{t('selection.label.switch')}</span>
          <div className="demo-row">
            <GlassLightGroup>
              <span className="demo-toggle">
                <GlassSwitch checked={wifi} onChange={setWifi} {...glassProps(params)} />
                <span>{t('selection.wifi')}</span>
              </span>
              <span className="demo-toggle">
                <GlassSwitch checked={bluetooth} onChange={setBluetooth} size="sm" {...glassProps(params)} />
                <span>{t('selection.bluetooth')}</span>
              </span>
              <span className="demo-toggle">
                <GlassSwitch checked={power} onChange={setPower} size="lg" {...glassProps(params)} />
                <span>{t('selection.large')}</span>
              </span>
              <span className="demo-toggle">
                <GlassSwitch checked disabled {...glassProps(params)} />
                <span>{t('selection.disabled')}</span>
              </span>
            </GlassLightGroup>
          </div>
        </div>
        <div className="demo-group">
          <span className="demo-label">{t('selection.label.checkbox')}</span>
          <div className="demo-row">
            <GlassLightGroup>
              <span className="demo-toggle">
                <GlassCheckbox
                  checked={checks.motion}
                  onChange={() => toggle('motion')}
                  {...glassProps(params)}
                />
                <span>{t('selection.motion')}</span>
              </span>
              <span className="demo-toggle">
                <GlassCheckbox
                  checked={checks.refract}
                  onChange={() => toggle('refract')}
                  size="sm"
                  {...glassProps(params)}
                />
                <span>{t('selection.refract')}</span>
              </span>
              <span className="demo-toggle">
                <GlassCheckbox
                  checked={checks.sound}
                  onChange={() => toggle('sound')}
                  size="lg"
                  {...glassProps(params)}
                />
                <span>{t('selection.sound')}</span>
              </span>
              <span className="demo-toggle">
                <GlassCheckbox checked={false} disabled {...glassProps(params)} />
                <span>{t('selection.disabled')}</span>
              </span>
            </GlassLightGroup>
          </div>
        </div>
      </div>
    </DemoSection>
  );
}
