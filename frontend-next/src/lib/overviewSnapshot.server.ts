import 'server-only';
import { BACKEND_API } from './backendApi.server';
import { getOverviewPageSnapshot } from './overviewPageSnapshot';

export function getOverviewSnapshot() {
    return getOverviewPageSnapshot(BACKEND_API);
}
