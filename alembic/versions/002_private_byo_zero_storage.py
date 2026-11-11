"""Private BYO Model Registry and Zero-Storage Architecture Migration

Revision ID: 002
Revises: 001
Create Date: 2026-11-10

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '002'
down_revision = '001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Create private_model_registry table
    op.create_table(
        'private_model_registry',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('source_type', sa.String(length=32), nullable=False),
        sa.Column('source_uri', sa.String(length=512), nullable=False),
        sa.Column('base_model_ref', sa.String(length=255), nullable=True),
        sa.Column('param_count_b', sa.Float(), nullable=True),
        sa.Column('artifact_format', sa.String(length=32), server_default='hf_repo', nullable=False),
        sa.Column('encryption_alg', sa.String(length=32), server_default='none', nullable=False),
        sa.Column('artifact_sha256', sa.String(length=64), nullable=True),
        sa.Column('metadata_json', sa.Text(), server_default='{}', nullable=False),
        sa.Column('is_active', sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_private_model_registry_user_id'), 'private_model_registry', ['user_id'], unique=False)

    # 2. Add columns to training_jobs
    op.add_column('training_jobs', sa.Column('privacy_mode', sa.String(length=32), server_default='encrypted_staked_mesh', nullable=False))
    op.add_column('training_jobs', sa.Column('data_source_type', sa.String(length=32), server_default='tunnel_stream', nullable=False))
    op.add_column('training_jobs', sa.Column('storage_retention', sa.String(length=32), server_default='zero_retention', nullable=False))
    op.add_column('training_jobs', sa.Column('required_vram_gb', sa.Float(), server_default='4.0', nullable=False))
    op.add_column('training_jobs', sa.Column('private_model_id', sa.String(length=36), nullable=True))
    op.add_column('training_jobs', sa.Column('artifact_manifest_json', sa.Text(), server_default='{}', nullable=False))
    op.create_index(op.f('ix_training_jobs_private_model_id'), 'training_jobs', ['private_model_id'], unique=False)

    # 3. Add columns to workers
    op.add_column('workers', sa.Column('tunnel_pubkey_x25519', sa.String(length=128), nullable=True))
    op.add_column('workers', sa.Column('supports_sealed_env', sa.Boolean(), server_default=sa.false(), nullable=False))
    op.add_column('workers', sa.Column('supports_zero_disk_shm', sa.Boolean(), server_default=sa.false(), nullable=False))
    op.add_column('workers', sa.Column('tee_attestation_type', sa.String(length=32), server_default='none', nullable=False))
    op.add_column('workers', sa.Column('gpu_count', sa.Integer(), server_default='1', nullable=False))
    op.add_column('workers', sa.Column('collective_vram_gb', sa.Float(), server_default='0.0', nullable=False))
    op.add_column('workers', sa.Column('largest_single_gpu_gb', sa.Float(), server_default='0.0', nullable=False))
    op.add_column('workers', sa.Column('training_ready', sa.Boolean(), server_default=sa.true(), nullable=True))
    op.add_column('workers', sa.Column('missing_training_packages', sa.Text(), server_default='[]', nullable=True))

    # 4. Add columns to inference_endpoints
    op.add_column('inference_endpoints', sa.Column('privacy_mode', sa.String(length=32), server_default='encrypted_staked_mesh', nullable=False))
    op.add_column('inference_endpoints', sa.Column('private_model_id', sa.String(length=36), nullable=True))
    op.create_index(op.f('ix_inference_endpoints_private_model_id'), 'inference_endpoints', ['private_model_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_inference_endpoints_private_model_id'), table_name='inference_endpoints')
    op.drop_column('inference_endpoints', 'private_model_id')
    op.drop_column('inference_endpoints', 'privacy_mode')

    op.drop_column('workers', 'missing_training_packages')
    op.drop_column('workers', 'training_ready')
    op.drop_column('workers', 'largest_single_gpu_gb')
    op.drop_column('workers', 'collective_vram_gb')
    op.drop_column('workers', 'gpu_count')
    op.drop_column('workers', 'tee_attestation_type')
    op.drop_column('workers', 'supports_zero_disk_shm')
    op.drop_column('workers', 'supports_sealed_env')
    op.drop_column('workers', 'tunnel_pubkey_x25519')

    op.drop_index(op.f('ix_training_jobs_private_model_id'), table_name='training_jobs')
    op.drop_column('training_jobs', 'artifact_manifest_json')
    op.drop_column('training_jobs', 'private_model_id')
    op.drop_column('training_jobs', 'required_vram_gb')
    op.drop_column('training_jobs', 'storage_retention')
    op.drop_column('training_jobs', 'data_source_type')
    op.drop_column('training_jobs', 'privacy_mode')

    op.drop_index(op.f('ix_private_model_registry_user_id'), table_name='private_model_registry')
    op.drop_table('private_model_registry')
