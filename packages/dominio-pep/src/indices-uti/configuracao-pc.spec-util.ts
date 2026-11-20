// A configuração dos índices de UTI do estabelecimento pc (fixture da cópia de dev, 2026-10-25; dado de domínio, sem
// paciente), no formato do contrato, para os testes do motor.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ConfiguracaoIndicesUti } from '@sgh/contratos';
import { comImpressao } from './configuracao.js';

export const CONFIG: ConfiguracaoIndicesUti = await comImpressao(
  JSON.parse(readFileSync(resolve(import.meta.dirname, '__fixtures__/configuracao-pc.json'), 'utf8')) as Omit<
    ConfiguracaoIndicesUti,
    'impressao'
  >,
);
