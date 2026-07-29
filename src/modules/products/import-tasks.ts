// offerId -> Ozon import task_id. Sadece "oluşturma sürüyor" durumunu izlemek için, kalıcı olması gerekmiyor.
const tasksByOfferId = new Map<string, number>();

export function setImportTask(offerId: string, taskId: number) {
  tasksByOfferId.set(offerId, taskId);
}

export function getImportTask(offerId: string): number | undefined {
  return tasksByOfferId.get(offerId);
}

export function clearImportTask(offerId: string) {
  tasksByOfferId.delete(offerId);
}
