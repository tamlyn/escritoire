import { createContext, useContext } from 'react'
import type { Project } from '../../shared/api'

export const ProjectContext = createContext<Project | null>(null)

/** The project whose workspace this component is rendered in. */
export function useProject(): Project {
  const project = useContext(ProjectContext)
  if (!project) throw new Error('useProject must be used inside a project workspace')
  return project
}
