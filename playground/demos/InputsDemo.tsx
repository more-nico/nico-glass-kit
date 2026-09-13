import { useState } from 'react';
import { GlassInput, GlassLightGroup, GlassSelect } from 'nico-glass-kit';
import type { DemoParams } from '../App';
import { DemoSection } from './DemoSection';
import { glassProps } from './demoProps';
import { CloseIcon, InfoIcon, SearchIcon } from './icons';

const KIND_ITEMS = [
  { key: 'photo', label: '照片' },
  { key: 'video', label: '视频' },
  { key: 'audio', label: '音频' },
  { key: 'live', label: '直播（暂不可用）', disabled: true },
];

const SIZE_ITEMS = [
  { key: 'sm', label: '小尺寸' },
  { key: 'md', label: '标准尺寸' },
  { key: 'lg', label: '大尺寸' },
];

export function InputsDemo({ params }: { params: DemoParams }) {
  const [query, setQuery] = useState('液态玻璃');
  const [kind, setKind] = useState('photo');
  const [size, setSize] = useState('md');

  return (
    <DemoSection
      index="05"
      title="GlassInput & GlassSelect"
      description="文本输入与下拉选择：图标、前后缀、校验态与禁用态"
      params={params}
    >
      <div className="demo-body">
        <div className="demo-group">
          <span className="demo-label">尺寸 Size</span>
          <div className="demo-row">
            <GlassLightGroup>
              <GlassInput
                className="demo-field"
                size="sm"
                placeholder="小尺寸 sm"
                {...glassProps(params)}
                cornerRadius={params.cornerRadius}
              />
              <GlassInput
                className="demo-field"
                size="md"
                leading={<SearchIcon />}
                placeholder="搜索组件…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                {...glassProps(params)}
                cornerRadius={params.cornerRadius}
              />
              <GlassInput
                className="demo-field"
                size="lg"
                placeholder="大尺寸 lg"
                {...glassProps(params)}
                cornerRadius={params.cornerRadius}
              />
            </GlassLightGroup>
          </div>
        </div>
        <div className="demo-group">
          <span className="demo-label">状态 State</span>
          <div className="demo-row">
            <GlassLightGroup>
              <GlassInput
                className="demo-field"
                invalid
                defaultValue="格式不正确"
                leading={<InfoIcon />}
                {...glassProps(params)}
                cornerRadius={params.cornerRadius}
              />
              <GlassInput
                className="demo-field"
                disabled
                placeholder="禁用 disabled"
                {...glassProps(params)}
                cornerRadius={params.cornerRadius}
              />
              <GlassInput
                className="demo-field"
                placeholder="带清除按钮"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                trailing={
                  query ? (
                    <button type="button" onClick={() => setQuery('')} aria-label="清除">
                      <CloseIcon />
                    </button>
                  ) : undefined
                }
                {...glassProps(params)}
                cornerRadius={params.cornerRadius}
              />
            </GlassLightGroup>
          </div>
        </div>
        <div className="demo-group">
          <span className="demo-label">选择 Select</span>
          <div className="demo-row">
            <GlassLightGroup>
              <GlassSelect
                className="demo-field"
                items={KIND_ITEMS}
                value={kind}
                onChange={setKind}
                aria-label="内容类型"
                {...glassProps(params)}
                cornerRadius={params.cornerRadius}
              />
              <GlassSelect
                className="demo-field"
                size="sm"
                items={SIZE_ITEMS}
                value={size}
                onChange={setSize}
                aria-label="尺寸"
                {...glassProps(params)}
                cornerRadius={params.cornerRadius}
              />
              <GlassSelect
                className="demo-field"
                items={SIZE_ITEMS}
                placeholder="禁用状态"
                disabled
                aria-label="禁用选择"
                {...glassProps(params)}
                cornerRadius={params.cornerRadius}
              />
              <GlassSelect
                className="demo-field"
                size="lg"
                items={SIZE_ITEMS}
                value={size}
                onChange={setSize}
                aria-label="尺寸（大号）"
                {...glassProps(params)}
                cornerRadius={params.cornerRadius}
              />
            </GlassLightGroup>
          </div>
        </div>
      </div>
    </DemoSection>
  );
}
