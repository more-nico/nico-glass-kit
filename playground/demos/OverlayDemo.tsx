import { useState } from 'react';
import { GlassAlert, GlassButton, GlassLightGroup, GlassModal, GlassTooltip } from 'nico-glass-kit';
import type { DemoParams } from '../App';
import { DemoSection } from './DemoSection';
import { glassProps } from './demoProps';
import { DownloadIcon, InfoIcon, PlusIcon } from './icons';

export function OverlayDemo({ params }: { params: DemoParams }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [alertOpen, setAlertOpen] = useState(true);

  return (
    <DemoSection
      index="10"
      title="GlassAlert & GlassTooltip & GlassModal"
      description="提示条、悬停气泡与玻璃弹窗；弹窗支持 Esc 与点遮罩关闭"
      params={params}
    >
      <div className="demo-body">
        <div className="demo-group">
          <span className="demo-label">提示 Alert</span>
          <div className="demo-column">
            <GlassAlert
              className="demo-alert"
              tone="info"
              title="有新版本可用"
              {...glassProps(params)}
              cornerRadius={params.cornerRadius}
            >
              v0.4 已发布，包含 13 个常用组件与统一的面板控制。
            </GlassAlert>
            <GlassAlert
              className="demo-alert"
              tone="success"
              title="同步完成"
              {...glassProps(params)}
              cornerRadius={params.cornerRadius}
            >
              12 个文件已更新到云端。
            </GlassAlert>
            <GlassAlert
              className="demo-alert"
              tone="danger"
              title="链接已失效"
              {...glassProps(params)}
              cornerRadius={params.cornerRadius}
            >
              请重新生成分享链接后再试。
            </GlassAlert>
            {alertOpen ? (
              <GlassAlert
                className="demo-alert"
                tone="warning"
                title="存储空间不足"
                onClose={() => setAlertOpen(false)}
                {...glassProps(params)}
                cornerRadius={params.cornerRadius}
              >
                剩余 4%，清理后可恢复上传。
              </GlassAlert>
            ) : (
              <div className="demo-row">
                <GlassLightGroup>
                  <GlassButton size="sm" onClick={() => setAlertOpen(true)} {...glassProps(params)}>
                    恢复提示
                  </GlassButton>
                </GlassLightGroup>
              </div>
            )}
          </div>
        </div>
        <div className="demo-group">
          <span className="demo-label">气泡 Tooltip</span>
          <div className="demo-row">
            <GlassLightGroup>
              <GlassTooltip content="顶部提示" placement="top" {...glassProps(params)}>
                <GlassButton size="sm" {...glassProps(params)}>
                  上
                </GlassButton>
              </GlassTooltip>
              <GlassTooltip content="底部提示" placement="bottom" {...glassProps(params)}>
                <GlassButton size="sm" icon={<InfoIcon />} {...glassProps(params)}>
                  下
                </GlassButton>
              </GlassTooltip>
              <GlassTooltip content="左侧提示" placement="left" {...glassProps(params)}>
                <GlassButton size="sm" variant="icon" icon={<DownloadIcon />} aria-label="下载" {...glassProps(params)} />
              </GlassTooltip>
              <GlassTooltip content="右侧提示" placement="right" {...glassProps(params)}>
                <GlassButton size="sm" icon={<PlusIcon />} {...glassProps(params)}>
                  右
                </GlassButton>
              </GlassTooltip>
            </GlassLightGroup>
          </div>
        </div>
        <div className="demo-group">
          <span className="demo-label">弹窗 Modal</span>
          <div className="demo-row">
            <GlassLightGroup>
              <GlassButton onClick={() => setModalOpen(true)} {...glassProps(params)}>
                打开弹窗
              </GlassButton>
            </GlassLightGroup>
          </div>
        </div>
      </div>

      <GlassModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="新建玻璃面板"
        footer={
          <GlassLightGroup>
            <GlassButton size="sm" onClick={() => setModalOpen(false)} {...glassProps(params)}>
              取消
            </GlassButton>
            <GlassButton size="sm" onClick={() => setModalOpen(false)} {...glassProps(params)}>
              创建
            </GlassButton>
          </GlassLightGroup>
        }
        {...glassProps(params)}
        cornerRadius={params.cornerRadius}
      >
        弹窗内容同样由右侧面板控制：材质、折射、高光与圆角实时生效。
      </GlassModal>
    </DemoSection>
  );
}
