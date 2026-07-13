import { logError } from '../utils/logger';
import { useState, useEffect, useMemo } from 'react';
import { 
  collection, 
  query, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc,
  serverTimestamp,
  orderBy
} from 'firebase/firestore';
import { db, appId } from '../services/firebase';
import { canonicalizeProjectCode } from '../finance/projectCodeAliases';

const normalizeProjectPayload = (projectData = {}) => {
  const code = canonicalizeProjectCode(projectData.code || projectData.codigo || '');
  const name = String(projectData.name || projectData.nombre || code || '').trim();
  return {
    ...projectData,
    code,
    name,
    displayName:
      projectData.displayName ||
      (code && name ? `${code} (${name})` : name || code),
  };
};

export const useProjects = (user) => {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const projectsRef = useMemo(
    () => collection(db, 'artifacts', appId, 'public', 'data', 'projects'),
    [],
  );

  useEffect(() => {
    if (!user) return undefined;

    const q = query(projectsRef, orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setProjects(data);
        setLoading(false);
      },
      (err) => {
        logError("Error loading projects:", err);
        setError(err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [projectsRef, user]);

  const createProject = async (projectData) => {
    if (!user) return { success: false, error: 'No user' };

    try {
      const normalized = normalizeProjectPayload(projectData);
      if (!normalized.code) {
        return { success: false, error: new Error('code canónico requerido (ej. QFF, NE4)') };
      }
      // Prevent duplicate canonical codes
      const exists = projects.some(
        (p) => canonicalizeProjectCode(p.code) === normalized.code && p.status !== 'inactive',
      );
      if (exists) {
        return { success: false, error: new Error(`Ya existe un proyecto con code ${normalized.code}`) };
      }
      await addDoc(projectsRef, {
        ...normalized,
        createdAt: serverTimestamp(),
        createdBy: user.email,
        active: true,
        status: normalized.status || 'active',
      });
      return { success: true };
    } catch (err) {
      logError("Error creating project:", err);
      return { success: false, error: err };
    }
  };

  const updateProject = async (projectId, updates) => {
    if (!user) return { success: false, error: 'No user' };

    try {
      const normalized =
        updates.code != null || updates.name != null
          ? normalizeProjectPayload({ ...updates })
          : updates;
      const projectDoc = doc(db, 'artifacts', appId, 'public', 'data', 'projects', projectId);
      await updateDoc(projectDoc, {
        ...normalized,
        updatedAt: serverTimestamp(),
        updatedBy: user.email
      });
      return { success: true };
    } catch (err) {
      logError("Error updating project:", err);
      return { success: false, error: err };
    }
  };

  const deleteProject = async (projectId) => {
    if (!user) return { success: false, error: 'No user' };

    try {
      const projectDoc = doc(db, 'artifacts', appId, 'public', 'data', 'projects', projectId);
      await deleteDoc(projectDoc);
      return { success: true };
    } catch (err) {
      logError("Error deleting project:", err);
      return { success: false, error: err };
    }
  };

  const toggleProjectStatus = async (projectId, currentStatus) => {
    return updateProject(projectId, { active: !currentStatus });
  };

  return {
    projects,
    loading,
    error,
    createProject,
    updateProject,
    deleteProject,
    toggleProjectStatus
  };
};

export default useProjects;
