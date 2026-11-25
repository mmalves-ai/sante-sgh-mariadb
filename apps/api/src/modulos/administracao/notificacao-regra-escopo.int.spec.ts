// Contrato de efeito do escopo por estabelecimento da regra de alerta global (01-ADM L76) no MariaDB:
// - o estabelecimento A desativa a regra de todos só para si, pela porta própria (regra_alerta_estabelecimento), e
//   escolhe um destinatário só dele (regra_alerta_destinatario.estabelecimento_id);
// - a consulta "alertas" da administração mostra a regra inativa e com o destinatário em A, e ativa e sem destinatário
//   em B;
// - a prescrição lê a regra como inativa em A (não é aplicada) e ativa em B; a regra em si fica intacta (ativo).
// Massa sintética (prefixo L76E).
import { randomUUID } from 'node:crypto';
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { CatalogoPrescricaoPropria } from '../pep/prescricao-propria-catalogo.js';
import { FonteAdministracaoPropria } from './fonte-propria.js';
import { NotificacaoRegraPropria, type RegraAlertaLida } from './notificacao-regra-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o5';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'L76E';
const CODIGO = `${P}R1`;

describe.skipIf(SEM_BANCO)('regra de alerta global com escopo por estabelecimento', () => {
  const nucleo = new NucleoProprio();
  let porta: NotificacaoRegraPropria;
  let fonte: FonteAdministracaoPropria;
  let catalogo: CatalogoPrescricaoPropria;
  const ids = { estA: 0, estB: 0, usuario: 0, cenario: 0, regra: 0, cenarioCriado: false };
  const um = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-l76e' }, (l) => l.uma(sql, p));

  async function limpar(): Promise<void> {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-l76e' }, async (e) => {
      const regras = `SELECT id FROM regra_alerta WHERE codigo LIKE '${P}%'`;
      await e.executar(`DELETE FROM regra_alerta_destinatario WHERE regra_alerta_id IN (${regras})`, []);
      await e.executar(`DELETE FROM regra_alerta_versao WHERE regra_alerta_id IN (${regras})`, []);
      await e.executar(`DELETE FROM regra_alerta_estabelecimento WHERE regra_alerta_id IN (${regras})`, []);
      await e.executar(`DELETE FROM regra_alerta WHERE codigo LIKE '${P}%'`, []);
      await limparTrilhaDaMassa(e, { codigos: [P] });
    });
  }

  beforeAll(async () => {
    if ((await nucleo.cliente(CLIENTE)).banco !== `cliente_${CLIENTE}`)
      throw new Error('Cliente de teste inesperado.');
    await limpar();
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-l76e' }, async (e) => {
      const hoje = new Date();
      const g = async (sel: string, p: unknown[], ins: string, pi: unknown[]) => {
        const l = await e.uma<{ id: number }>(sel, p);
        return l ? Number(l.id) : e.inserir(ins, pi);
      };
      const est = (codigo: string) =>
        g(
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [codigo],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [codigo, `ESTAB ${codigo} SINTETICO`, `ESTAB ${codigo} SINTETICO`, hoje],
        );
      ids.estA = await est(`${P}A`);
      ids.estB = await est(`${P}B`);
      ids.usuario = await g(
        'SELECT id FROM usuario WHERE login = ?',
        [`${P}.A`],
        "INSERT INTO usuario (login, nome, dispensa_cpf, tipo_conta, criado_em) VALUES (?, 'PESSOA SINTETICA', TRUE, 'pessoa', ?)",
        [`${P}.A`, hoje],
      );
      const cen = await e.uma<{ id: number }>("SELECT id FROM cenario_alerta WHERE codigo = 'interacao'", []);
      ids.cenarioCriado = !cen;
      ids.cenario = cen
        ? Number(cen.id)
        : await e.inserir(
            "INSERT INTO cenario_alerta (codigo, descricao, verificador, criado_em) VALUES ('interacao', 'Interação (sintético)', ?, ?)",
            [P, hoje],
          );
      // A regra de todos os estabelecimentos (sem estabelecimento), criada pela plataforma.
      ids.regra = await e.inserir(
        `INSERT INTO regra_alerta (estabelecimento_id, codigo, nome, cenario_alerta_id, mensagem, bloqueante,
           vigencia_inicio, criado_em) VALUES (NULL, ?, 'REGRA GLOBAL SINTETICA L76E', ?, 'MENSAGEM SINTETICA', TRUE, '2026-01-05', ?)`,
        [CODIGO, ids.cenario, hoje],
      );
    });
    porta = new NotificacaoRegraPropria(nucleo, CLIENTE, false);
    fonte = new FonteAdministracaoPropria(nucleo, CLIENTE, { rede: 'rede-sint' });
    await fonte.carregar();
    catalogo = new CatalogoPrescricaoPropria(nucleo, CLIENTE);
  });

  afterAll(async () => {
    await limpar();
    if (ids.cenarioCriado)
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-l76e' }, (e) =>
        e.executar("DELETE FROM cenario_alerta WHERE codigo = 'interacao' AND verificador = ?", [P]),
      );
    await nucleo.encerrar();
  });

  const doPainel = async (hospital: string): Promise<RegraAlertaLida> => {
    const r = (await porta.painel({ hospital, login: `${P}.A` })).regras.find((x) => x.codigo === CODIGO);
    if (!r) throw new Error('regra sintética fora do painel');
    return r;
  };
  const daConsulta = async (hospital: string) => {
    const a = (await fonte.alertas({ rede: 'rede-sint', hospital, traceId: 'teste-l76e' })).find(
      (x) => x.id === ids.regra,
    );
    if (!a) throw new Error('regra sintética fora da consulta');
    return a;
  };
  const daPrescricao = async (hospital: string) => {
    const r = (
      await catalogo.regrasAlerta({
        cliente: CLIENTE,
        estabelecimento: null,
        usuario: null,
        correlacao: P,
        rede: 'rede-sint',
        hospital,
      })
    ).find((x) => x.codigo === CODIGO);
    if (!r) throw new Error('regra sintética fora da prescrição');
    return r;
  };

  it('antes: a regra global vale nos dois estabelecimentos, sem destinatário', async () => {
    expect((await daConsulta(`${P}A`)).ativo).toBe(true);
    expect((await daConsulta(`${P}B`)).ativo).toBe(true);
    expect((await daPrescricao(`${P}A`)).ativa).toBe(true);
    expect((await daPrescricao(`${P}B`)).ativa).toBe(true);
    expect((await daConsulta(`${P}A`)).usuarios).toBe(0);
  });

  it('A desativa só para si e escolhe um destinatário só dele: consulta e prescrição respeitam o escopo', async () => {
    const r = await doPainel(`${P}A`);
    expect(r.global).toBe(true);
    expect(r.conteudoEditavel).toBe(false);
    await porta.gravarRegraAlerta(
      {
        hospital: `${P}A`,
        login: `${P}.A`,
        correlacao: 'teste-l76e',
        chaveIdempotencia: `tl76e-${randomUUID()}`,
      },
      {
        id: r.id,
        versao: r.versao,
        codigo: r.codigo,
        nome: r.nome,
        cenario: r.cenario,
        descricao: r.descricao,
        mensagem: r.mensagem,
        gravidade: r.gravidade,
        bloqueante: r.bloqueante,
        exigeJustificativa: r.exigeJustificativa,
        sexo: r.sexo,
        idadeMinima: r.idadeMinima,
        idadeMaxima: r.idadeMaxima,
        repeticao: r.repeticao,
        intervaloMinutos: r.repeticao === 'intervalo' ? r.intervaloMinutos : null,
        notificaTela: r.notifica.tela,
        notificaEmail: r.notifica.email,
        notificaSms: r.notifica.sms,
        notificaAplicativo: r.notifica.aplicativo,
        consolidacao: r.consolidacao,
        vigenciaInicio: r.vigenciaInicio,
        vigenciaFim: r.vigenciaFim,
        ativo: false,
        destinatarios: [{ tipo: 'usuario', codigo: `${P}.A` }],
      },
    );
    // No banco: a regra em si continua ativa; o registro do estabelecimento A a desativa; o destinatário é de A.
    expect(Number((await um('SELECT ativo FROM regra_alerta WHERE id = ?', [ids.regra]))?.['ativo'])).toBe(1);
    expect(
      Number(
        (
          await um(
            'SELECT ativo FROM regra_alerta_estabelecimento WHERE regra_alerta_id = ? AND estabelecimento_id = ?',
            [ids.regra, ids.estA],
          )
        )?.['ativo'],
      ),
    ).toBe(0);
    expect(
      await um(
        'SELECT estabelecimento_id AS e FROM regra_alerta_destinatario WHERE regra_alerta_id = ? AND usuario_id = ? AND ativo',
        [ids.regra, ids.usuario],
      ),
    ).toEqual({ e: ids.estA });

    const consultaA = await daConsulta(`${P}A`);
    const consultaB = await daConsulta(`${P}B`);
    expect([consultaA.ativo, consultaA.usuarios]).toEqual([false, 1]);
    expect([consultaB.ativo, consultaB.usuarios]).toEqual([true, 0]);
    expect((await daPrescricao(`${P}A`)).ativa).toBe(false);
    expect((await daPrescricao(`${P}B`)).ativa).toBe(true);
  });
});
