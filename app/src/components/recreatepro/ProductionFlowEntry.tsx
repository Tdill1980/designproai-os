import { Navigate, useLocation } from 'react-router-dom';

/** Old prep entry links now reach RecreatePro. Generation-specific progress
 * routes and the normal ProductionFlow job list are unchanged. */
export default function ProductionFlowEntry() {
  const { search } = useLocation();
  return <Navigate to={new URLSearchParams(search).get('tab') === 'prep' ? '/recreatepro' : '/designpro/jobs'} replace />;
}
