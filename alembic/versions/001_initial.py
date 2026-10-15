"initial migration"

Revision ID: 001
Revises: 
Create Date: 2026-04-07

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'tasks',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('task_id', sa.String(length=255), nullable=False),
        sa.Column('prompt', sa.Text(), nullable=False),
        sa.Column('status', sa.Enum('PENDING', 'QUEUED', 'PROCESSING', 'SUCCESS', 'FAILURE', name='taskstatus'), nullable=False),
        sa.Column('result', sa.Text(), nullable=True),
        sa.Column('output_url', sa.String(length=500), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_tasks_id'), 'tasks', ['id'], unique=False)
    op.create_index(op.f('ix_tasks_task_id'), 'tasks', ['task_id'], unique=True)


def downgrade() -> None:
    op.drop_index(op.f('ix_tasks_task_id'), table_name='tasks')
    op.drop_index(op.f('ix_tasks_id'), table_name='tasks')
    op.drop_table('tasks')
