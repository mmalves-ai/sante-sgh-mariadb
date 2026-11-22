// Conversões puras da persistência do ADR 0009 (sem banco).
import { createHash } from 'node:crypto';
import { esquemaRegraPrecoParticular } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { hashTextoAgenda, regraPrecoParticularDe, restricaoDe } from './linhas.js';

describe('persistência do preço particular e da agenda estruturada', () => {
  it('hash do texto: 16 primeiros bytes do SHA-256 do UTF-8, em hexadecimal', () => {
    const t = 'Consulta particular R$ 250,00\nNão atende plano básico';
    expect(hashTextoAgenda(t)).toBe(
      createHash('sha256').update(Buffer.from(t, 'utf8')).digest('hex').slice(0, 32),
    );
    expect(hashTextoAgenda(t)).toHaveLength(32);
    expect(hashTextoAgenda(t + ' ')).not.toBe(hashTextoAgenda(t));
  });

  it('regra lida: dono, alvo, valor em reais e datas; passa no esquema do contrato', () => {
    const r = regraPrecoParticularDe({
      id: 3,
      estabelecimento_id: null,
      fonte_pagadora_id: 1,
      profissional_id: null,
      agenda_servico_id: 9,
      alvo: 'consulta',
      item_faturavel_id: null,
      grupo_faturamento_id: null,
      valor: '250.00',
      prioridade: 100,
      vigencia_inicio: '2026-01-01',
      vigencia_fim: null,
      situacao_revisao: 'estimada',
      texto_origem_agenda_id: 4,
      observacao: null,
      ativo: 1,
      origem: 'migracao',
      versao: 1,
    });
    expect(r.dono).toEqual({ tipo: 'agenda', agendaId: 9 });
    expect(r.alvo).toEqual({ tipo: 'consulta' });
    expect(r.valor).toBe(250);
    expect(esquemaRegraPrecoParticular.parse(r)).toEqual(r);
  });

  it('restrição lida: nulo herda da agenda, booleanos do banco', () => {
    const r = restricaoDe({
      id: 1,
      versao: 1,
      fonte_pagadora_id: null,
      plano_fonte_pagadora_id: null,
      item_agendavel_id: null,
      sexo_atendido: null,
      idade_minima_anos: 12,
      idade_maxima_anos: null,
      aceita_retorno: 0,
      dias_retorno: null,
      permite_encaixe: null,
      vigencia_inicio: '2026-01-01',
      vigencia_fim: null,
      situacao_revisao: 'confirmada',
      texto_origem_agenda_id: null,
    });
    expect(r).toMatchObject({
      idadeMinimaAnos: 12,
      sexoAtendido: null,
      aceitaRetorno: false,
      permiteEncaixe: null,
    });
  });
});
