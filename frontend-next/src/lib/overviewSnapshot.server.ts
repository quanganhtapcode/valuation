import 'server-only';
import { BACKEND_API } from './backendApi.server';
import { getOverviewPageSnapshots } from './overviewPageSnapshot';

export function getOverviewSnapshots() {
    return getOverviewPageSnapshots(BACKEND_API);
}
