IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = 'IX_Machines_SequenceNo' AND object_id = OBJECT_ID('dbo.Machines')
)
CREATE INDEX IX_Machines_SequenceNo ON dbo.Machines(sequence_no);

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = 'IX_Scanners_IsActive' AND object_id = OBJECT_ID('dbo.Scanners')
)
CREATE INDEX IX_Scanners_IsActive ON dbo.Scanners(is_active);

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = 'IX_ProductionLogs_CreatedAt' AND object_id = OBJECT_ID('dbo.ProductionLogs')
)
CREATE INDEX IX_ProductionLogs_CreatedAt ON dbo.ProductionLogs(createdAt);

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = 'IX_ProductionLogs_Machine' AND object_id = OBJECT_ID('dbo.ProductionLogs')
)
CREATE INDEX IX_ProductionLogs_Machine ON dbo.ProductionLogs(machine_id);

