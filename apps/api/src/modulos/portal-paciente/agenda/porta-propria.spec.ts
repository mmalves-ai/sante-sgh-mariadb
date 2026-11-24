// Unidade da porta própria da agenda online (M50, etapa 2): o mapeamento das linhas do banco para a forma do portal
// (situações, tipo pela natureza da agenda, documentos, forma de pagamento, listas e CRM), a reserva vencida, o
// estabelecimento inexistente e a confirmação do pagamento sem modelo (503). O núcleo é um leitor falso por SQL.
import type { Executor, Leitor, Linha } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import type { NucleoPortal } from '../porta-propria.js';
import { PortaAgendaOnlinePropria } from './porta-propria.js';

function nucleoFalso(responder: (sql: string, p: readonly unknown[]) => Linha[]): NucleoPortal {
  const leitor = {
    cliente: 'teste',
    consultar: async (sql: string, p: readonly unknown[] = []) => responder(sql, p),
    uma: async (sql: string, p: readonly unknown[] = []) => responder(sql, p)[0] ?? null,
  } as unknown as Leitor;
  return {
    lerSomente: (_c, fn) => fn(leitor),
    criarExecutor: () =>
      ({
        executar: async (op: { gravar: (tx: unknown) => Promise<unknown> }) => op.gravar({}),
      }) as unknown as Executor,
  };
}

const c = { rede: 'teste', hospital: 'H1' };
const estab = (sql: string) => sql.includes('FROM estabelecimento');

describe('PortaAgendaOnlinePropria (unidade)', () => {
  it('configuração: listas do GROUP_CONCAT, CRM só com os dígitos, carimbo e quem alterou', async () => {
    const porta = new PortaAgendaOnlinePropria(
      nucleoFalso((sql) =>
        estab(sql)
          ? [{ id: 1, fuso_horario: null }]
          : [
              {
                id: 5,
                tipo: 'consulta',
                agenda_servico_id: 9,
                ativa: 1,
                antecedencia_horas: 2,
                horizonte_dias: 30,
                cancela_ate_horas: 12,
                pre_checkin: 0,
                valor_particular: '150.00',
                teleconsulta: 1,
                criado_em: new Date('2026-11-23T10:00:00Z'),
                alterado_em: null,
                versao: 3,
                nome_agenda: 'AGENDA',
                crm: 'SP-12345',
                alterado_login: 'U1',
                convenios: '3,7',
                servicos: null,
              },
            ],
      ),
    );
    expect(await porta.configs(c)).toEqual([
      {
        id: 5,
        tipo: 'consulta',
        agenda: 9,
        nomeAgenda: 'AGENDA',
        crm: 12345,
        ativa: true,
        convenios: [3, 7],
        servicos: [],
        antecedenciaHoras: 2,
        horizonteDias: 30,
        cancelaAteHoras: 12,
        precheckin: false,
        valorParticular: 150,
        teleconsulta: true,
        alteradoPor: 'U1',
        alteradoEm: '2026-11-23T10:00:00.000',
        versao: 3,
      },
    ]);
  });

  it('pré-check-in: concluido é "enviado", tipo pela natureza, documento no vocabulário do portal, reserva vencida some', async () => {
    const porta = new PortaAgendaOnlinePropria(
      nucleoFalso((sql) => {
        if (estab(sql)) return [{ id: 1, fuso_horario: 'America/Sao_Paulo' }];
        if (sql.includes('FROM pre_checkin_documento'))
          return [
            {
              pre_checkin_id: 4,
              tipo: 'carteira_convenio',
              resumo_conteudo: 'h',
              tipo_midia: 'image/png',
              chave_armazenamento: 'k',
            },
          ];
        return [
          {
            id: 4,
            natureza: 'exame',
            marcacao_horario_id: 8,
            nome_agenda: 'RX',
            crm: null,
            data_referencia: '2026-11-24',
            inicio_em: new Date('2026-11-24T13:30:00Z'),
            paciente_id: 2,
            conta_portal_paciente_id: 6,
            dados_propostos: '{"a":1}',
            numero_carteira: null,
            validade_carteira: null,
            termos_versao: 'v2',
            situacao: 'concluido',
            motivo_recusa: null,
            concluido_em: new Date('2026-11-23T10:00:00Z'),
            conferido_login: null,
            conferido_em: null,
            reservado_login: 'U9',
            reserva_vale: 0,
            campos_gravados: null,
            versao: 2,
          },
        ];
      }),
    );
    const p = await porta.preCheckinPorId(c, 4);
    expect(p).toMatchObject({
      tipo: 'exame',
      situacao: 'enviado',
      data: '2026-11-24',
      hora: '10:30',
      crm: 0,
      dados: { a: 1 },
      documentos: [{ tipo: 'carteirinha', chave: 'k', sha256: 'h', mime: 'image/png' }],
      reservadoPor: null,
      camposGravados: [],
      enviadoEm: '2026-11-23T10:00:00.000',
    });
    expect(await porta.preCheckinDaMarcacao(c, 'consulta', 8)).toBeNull();
    expect(await porta.filaPreCheckin(c, { situacao: 'enviado', de: 'a', ate: 'b', pacientes: [] })).toEqual({
      itens: [],
      haMais: false,
    });
  });

  it('pagamento: cartão no vocabulário do portal; tesouraria com quem cobrou e os atos', async () => {
    const porta = new PortaAgendaOnlinePropria(
      nucleoFalso((sql) => {
        if (estab(sql)) return [{ id: 1, fuso_horario: null }];
        if (sql.includes('FROM conciliacao_pagamento_portal'))
          return [
            {
              id: 1,
              intencao_pagamento_portal_id: 3,
              acao: 'divergente',
              valor: '10.00',
              referencia: null,
              motivo: 'm',
              login: 'T',
              criado_em: new Date('2026-11-23T10:00:00Z'),
            },
          ];
        return [
          {
            id: 3,
            conta_portal_paciente_id: 6,
            paciente_id: 2,
            natureza: 'consulta',
            marcacao_horario_id: 8,
            valor: '10.00',
            forma: 'cartao_credito',
            conector: 'gateway',
            transacao: 't',
            situacao: 'confirmado',
            expira_em: new Date('2026-11-23T11:00:00Z'),
            recebimento_particular_id: 77,
            criado_em: new Date('2026-11-23T10:00:00Z'),
            confirmado_em: new Date('2026-11-23T10:01:00Z'),
            pix_copia_e_cola: null,
            endereco_cartao: null,
            versao: 2,
          },
        ];
      }),
    );
    const t = await porta.pagamentoTesouraria(c, 3);
    expect(t?.pagamento).toMatchObject({
      forma: 'cartao-credito',
      conector: 'gateway',
      pagamentoCaixa: 77,
      valor: 10,
    });
    expect(t?.cobradoPor).toBe('SGH.PORTAL');
    expect(t?.atos).toEqual([
      {
        id: 1,
        pagamento: 3,
        acao: 'divergente',
        valor: 10,
        referencia: null,
        motivo: 'm',
        usuario: 'T',
        em: '2026-11-23T10:00:00.000',
      },
    ]);
  });

  // A confirmação do pagamento grava de fato (porta-propria-pagamento.ts): o contrato de efeito dela está em
  // porta-propria-pagamento.int.spec.ts, contra o banco real.
  it('estabelecimento inexistente: 404', async () => {
    const vazio = new PortaAgendaOnlinePropria(nucleoFalso(() => []));
    await expect(vazio.configs(c)).rejects.toMatchObject({ problema: { status: 404 } });
  });
});
