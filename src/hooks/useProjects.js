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
import { sanitizeValue } from '../utils/sanitizeFirestore';

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
        // Sanitize doc fields so Timestamps and audit arrays stay render-safe
        const data = snapshot.docs.map(doc => ({
          id: doc.id,
          ...sanitizeValue(doc.data())
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
      await addDoc(projectsRef, {
        ...projectData,
        createdAt: serverTimestamp(),
        createdBy: user.email,
        active: true
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
      const projectDoc = doc(db, 'artifacts', appId, 'public', 'data', 'projects', projectId);
      await updateDoc(projectDoc, {
        ...updates,
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
