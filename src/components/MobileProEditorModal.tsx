import React from 'react';
import { CanonicalProjectDocument } from '../types/canonicalProject';
import {
  CatalogItem,
  ProjectLibraryItem,
  TemplateVariantInstance,
} from '../types/sowveil';
import { EditingStudioWorkspace } from './EditingStudioWorkspace';

export interface MobileProEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialProject?: CanonicalProjectDocument | null;
  sourceLibraryProject?: ProjectLibraryItem | null;
  sourceTemplate?: CatalogItem | null;
  sourceVariant?: TemplateVariantInstance | null;
  ownerUid?: string;
  onSaveToProjectLibrary: (
    record: Omit<ProjectLibraryItem, 'id' | 'updatedAt'> & { id?: string },
    existingProjectId?: string
  ) => Promise<void> | void;
  onNotify: (
    message: string,
    tone?: 'info' | 'warning' | 'error' | 'success'
  ) => void;
}

export const MobileProEditorModal: React.FC<MobileProEditorModalProps> = ({
  isOpen,
  onClose,
  initialProject,
  sourceLibraryProject,
  sourceTemplate,
  sourceVariant,
  ownerUid = 'user-local',
  onSaveToProjectLibrary,
  onNotify,
}) => {
  if (!isOpen) return null;

  return (
    <EditingStudioWorkspace
      mode="modal"
      onClose={onClose}
      initialProject={initialProject}
      sourceLibraryProject={sourceLibraryProject}
      sourceTemplate={sourceTemplate}
      sourceVariant={sourceVariant}
      ownerUid={ownerUid}
      onSaveToProjectLibrary={onSaveToProjectLibrary}
      onNotify={onNotify}
    />
  );
};
