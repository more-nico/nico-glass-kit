import { GlassLightGroup, GlassProgress, GlassSpinner } from 'nico-glass-kit';
import type { DemoParams } from '../App';
import { DemoSection } from './DemoSection';
import { glassProps } from './demoProps';

export function ProgressDemo({ params }: { params: DemoParams }) {
  return (
    <DemoSection
      index="09"
      title="GlassProgress & GlassSpinner"
      description="进度条与加载环：轨道、填充与圆点使用同一套控件 token"
      params={params}
    >
      <div className="demo-body">
        <div className="demo-group">
          <span className="demo-label">进度 Progress</span>
          <div className="demo-column">
            <GlassProgress
              className="demo-progress"
              value={0.28}
              label="上传进度"
              {...glassProps(params)}
            />
            <GlassProgress
              className="demo-progress"
              size="sm"
              value={0.65}
              label="同步进度"
              {...glassProps(params)}
            />
            <GlassProgress
              className="demo-progress"
              size="lg"
              value={1}
              label="完成进度"
              {...glassProps(params)}
            />
          </div>
        </div>
        <div className="demo-group">
          <span className="demo-label">加载 Spinner</span>
          <div className="demo-row">
            <GlassLightGroup>
              <GlassSpinner size="sm" label="加载中 sm" {...glassProps(params)} />
              <GlassSpinner label="加载中" {...glassProps(params)} />
              <GlassSpinner size="lg" label="加载中 lg" {...glassProps(params)} />
            </GlassLightGroup>
          </div>
        </div>
      </div>
    </DemoSection>
  );
}
