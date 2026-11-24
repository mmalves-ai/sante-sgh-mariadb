// Integração das leituras próprias do portal do paciente (modulos-proprios-2, portal-leituras) contra o MariaDB real,
// cliente f22_o3, massa SINTÉTICA gravada pela gravação própria (porta-propria-gravacao.ts) no beforeAll e apagada no
// afterAll (a trilha é só de acréscimo e fica). Confere as 19 leituras como a porta de memória: filtros, ordem,
// página, versão e o escopo do estabelecimento (a conta de outro não é lida).
// Requer a migração 17_INTG/91_portal_gravacao. SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { type ContextoOperacao, definirOperacao, type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ContextoPortal, GravadorPortal } from './porta.js';
import { type EscritaPortal, gravadorGravacaoPropria, TABELAS_GRAVACAO_PORTAL } from './porta-propria-gravacao.js';
import { LeiturasPortalProprias } from './porta-propria-leitura.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const EST = 'PL0001';
const EST2 = 'PL0002';
const PRONT = [933_101, 933_102];
const CONFERENTE = 'pl.conferente';
const res = (s: string) => s.padEnd(64, '0').slice(0, 64);
const C: ContextoPortal = { rede: CLIENTE, hospital: EST };
const C2: ContextoPortal = { rede: CLIENTE, hospital: EST2 };
const trilha = {
  rede: CLIENTE,
  hospital: EST,
  usuario: 'SGH.PORTAL',
  evento: 'portal.teste',
  recurso: 'portal',
  operacao: 'teste',
  resultado: 'sucesso',
  estacao: null,
  correlacao: 'teste-portal-leituras',
};

type G = Omit<GravadorPortal, 'registrarManifestacao'>;

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

async function limpar(e: Escritor, est: number): Promise<void> {
  const sol = 'SELECT id FROM solicitacao_copia_prontuario WHERE estabelecimento_id = ?';
  await e.executar(`DELETE FROM ato_copia_prontuario WHERE solicitacao_copia_prontuario_id IN (${sol})`, [est]);
  await e.executar('DELETE FROM solicitacao_copia_prontuario WHERE estabelecimento_id = ?', [est]);
  await e.executar(
    'DELETE h FROM pedido_titular_historico h JOIN pedido_titular p ON p.id = h.pedido_titular_id WHERE p.estabelecimento_id = ?',
    [est],
  );
  await e.executar('DELETE FROM pedido_titular WHERE estabelecimento_id = ?', [est]);
  await e.executar(
    'DELETE h FROM consentimento_titular_historico h JOIN consentimento_titular c ON c.id = h.consentimento_titular_id WHERE c.estabelecimento_id = ?',
    [est],
  );
  await e.executar('DELETE FROM consentimento_titular WHERE estabelecimento_id = ?', [est]);
  const contas = 'SELECT id FROM conta_portal_paciente WHERE estabelecimento_id = ?';
  await e.executar(`DELETE FROM troca_email_conta_portal WHERE conta_portal_paciente_id IN (${contas})`, [est]);
  await e.executar('DELETE FROM vinculo_responsavel_portal WHERE estabelecimento_id = ?', [est]);
  await e.executar('DELETE FROM conta_portal_paciente WHERE estabelecimento_id = ?', [est]);
  await e.executar('DELETE FROM sequencia_negocio WHERE estabelecimento_id = ?', [est]);
}

async function limparPacientes(e: Escritor): Promise<void> {
  const pr = PRONT.map(() => '?').join(', ');
  const pfs = await e.consultar(`SELECT pessoa_fisica_id AS id FROM paciente WHERE numero_prontuario IN (${pr})`, PRONT);
  await e.executar(`DELETE FROM paciente WHERE numero_prontuario IN (${pr})`, PRONT);
  for (const x of pfs) await e.executar('DELETE FROM pessoa_fisica WHERE id = ?', [x['id']]);
}

describe.skipIf(SEM_BANCO)(`leituras próprias do portal do paciente (MariaDB, cliente ${CLIENTE})`, () => {
  const nucleo = new NucleoProprio();
  const ests = new Map<string, number>();
  let pac: number[] = [];
  const leituras = new LeiturasPortalProprias({
    ler: (c, fn) => nucleo.lerSomente({ cliente: c.rede, correlacao: 'teste-portal-leituras' }, fn),
    estabelecimento: (c) => Promise.resolve(ests.get(c.hospital) ?? 0),
  });
  const massa = {
    conta: 0,
    contaRes: 0,
    contaOutra: 0,
    vinculos: [] as number[],
    consentimento: 0,
    pedido: '',
    copia: '',
    inicio: new Date(),
  };

  async function gravar<T>(fn: (g: G) => Promise<T>, estab: number, dados?: Record<string, unknown>): Promise<T> {
    const correlacao = `portal-l-${randomUUID()}`.slice(0, 64);
    const ctx: ContextoOperacao = {
      cliente: CLIENTE,
      estabelecimento: estab,
      usuario: null,
      correlacao,
      chaveIdempotencia: correlacao,
    };
    const escrita: EscritaPortal = { tabela: 'conta_portal_paciente', id: null };
    let r!: T;
    const op = definirOperacao<{ correlacao: string }, { gravado: boolean }>({
      nome: 'portal-paciente.gravar',
      tabelas: [...TABELAS_GRAVACAO_PORTAL],
      entrada: z.object({ correlacao: z.string() }).strict(),
      gravar: async (tx) => {
        r = await fn(gravadorGravacaoPropria(tx, estab, escrita));
        return { gravado: true };
      },
      alvo: () => ({ tabela: escrita.tabela, id: escrita.id }),
      trilha: () => (dados ? { motivo: String(dados['evento']), dados } : {}),
    });
    await nucleo.criarExecutor().executar(op, CLIENTE, { correlacao }, ctx);
    return r;
  }
  const nova = (g: G, paciente: number | null, convite: string) =>
    g.criarConta({
      tipo: paciente === null ? 'responsavel' : 'paciente',
      paciente,
      prontuario: null,
      nome: paciente === null ? 'RESPONSAVEL SINTETICO' : null,
      nascimento: paciente === null ? '1980-01-01' : null,
      conviteResumo: res(convite),
      conviteValidoAte: new Date(Date.now() + 86_400_000),
      origem: 'recepcao',
      por: CONFERENTE,
    });

  beforeAll(async () => {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-portal-l' }, async (e) => {
      const agora = new Date();
      for (const codigo of [EST, EST2]) {
        const id = await garantir(
          e,
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [codigo],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [codigo, 'ESTAB SINTETICO PORTAL L', 'ESTAB SINTETICO PORTAL L', agora],
        );
        ests.set(codigo, id);
        await limpar(e, id);
      }
      await limparPacientes(e);
      await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        [CONFERENTE],
        "INSERT INTO usuario (login, nome, tipo_conta, dispensa_cpf, criado_em) VALUES (?, 'USUARIO SINTETICO PORTAL L', 'pessoa', TRUE, ?)",
        [CONFERENTE, agora],
      );
      await garantir(
        e,
        'SELECT id FROM tipo_termo_lgpd WHERE codigo = ?',
        ['portal_paciente'],
        "INSERT INTO tipo_termo_lgpd (codigo, descricao, ativo, finalidade, criado_em) VALUES ('portal_paciente', 'CONSENTIMENTO PELO PORTAL', TRUE, 'consentimento', ?)",
        [agora],
      );
      pac = [];
      for (const [i, nome] of ['DORA SINTETICA TESTE', 'EDU SINTETICO TESTE'].entries()) {
        const pf = await e.inserir(
          'INSERT INTO pessoa_fisica (nome, data_nascimento, falecida, criado_em) VALUES (?, ?, FALSE, ?)',
          [nome, '1990-07-01', agora],
        );
        pac.push(
          await e.inserir(
            "INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, situacao, falecido, criado_em) VALUES (?, ?, 'ativo', FALSE, ?)",
            [pf, PRONT[i], agora],
          ),
        );
      }
    });
    const est = ests.get(EST)!;
    massa.inicio = new Date(Date.now() - 60_000);
    massa.conta = (await gravar((g) => nova(g, pac[0]!, 'pl-conv-a'), est)).id;
    await gravar(
      (g) =>
        g.ativar(massa.conta, 1, {
          email: 'pl-a@x.test',
          emailResumo: res('pl-email-a'),
          senhaResumo: 'resumo-senha-sintetico',
          segundoFator: 'envelope-sintetico',
          termoUso: 'v1',
          politica: 'v1',
        }),
      est,
    );
    await gravar(
      (g) =>
        g.pedirTrocaEmail({
          conta: massa.conta,
          emailNovo: 'pl-b@x.test',
          emailNovoResumo: res('pl-email-b'),
          tokenResumo: res('pl-tok-1'),
          validoAte: new Date(Date.now() + 3_600_000),
          origem: 'portal',
          motivo: 'troca pedida pelo titular',
          pedidoPor: 'SGH.PORTAL.C1',
          envio: 'simulador',
        }),
      est,
    );
    massa.contaRes = (await gravar((g) => nova(g, null, 'pl-conv-r'), est)).id;
    for (const decidido of [CONFERENTE, null, null])
      massa.vinculos.push(
        (
          await gravar(
            (g) =>
              g.pedirVinculo({
                conta: massa.contaRes,
                titular: pac[0]!,
                prontuarioTitular: PRONT[0]!,
                tipo: 'procurador',
                prova: 'procuracao',
                arquivoChave: null,
                arquivoHash: null,
                validade: '2099-12-31',
                escopos: ['resultados', 'documentos'],
                canal: 'balcao',
                por: 'SGH.PORTAL.C9',
                decididoPor: decidido,
              }),
            est,
          )
        ).id,
      );
    massa.contaOutra = (await gravar((g) => nova(g, pac[0]!, 'pl-conv-o'), ests.get(EST2)!)).id;
    massa.consentimento = (
      await gravar(
        (g) =>
          g.registrarConsentimento({
            idPaciente: pac[0]!,
            pront: PRONT[0]!,
            finalidade: 'pesquisa',
            versao: '2',
            situacao: 3,
            signatario: 1,
            usuario: 'SGH.PORTAL',
            conta: massa.conta,
            vinculo: null,
          }),
        est,
      )
    ).id;
    await gravar(
      (g) => g.revogarConsentimento({ idPaciente: pac[0]!, id: massa.consentimento, motivo: 2, usuario: 'SGH.PORTAL' }),
      est,
    );
    massa.pedido = (
      await gravar(
        (g) =>
          g.registrarPedido(
            {
              idPaciente: pac[0]!,
              tipo: 'compartilhamento',
              descricao: null,
              por: 'SGH.PORTAL',
              prazoDias: 15,
              conta: massa.conta,
              identidadeVerificada: true,
            },
            trilha,
          ),
        est,
      )
    ).id;
    const copia = await gravar(
      (g) =>
        g.pedirCopia(
          {
            idPaciente: pac[0]!,
            canal: 'portal',
            conta: massa.conta,
            identidadeVerificada: false,
            descricao: null,
            por: 'SGH.PORTAL',
            prazoDias: 15,
            solicitante: 'titular',
            vinculo: null,
            prova: null,
          },
          { pedido: trilha, copia: trilha },
        ),
      est,
    );
    massa.copia = copia.id;
    await gravar(
      (g) =>
        g.registrarAtoCopia(
          {
            protocolo: copia.protocolo,
            idPaciente: null,
            ato: 'legitimidade',
            solicitante: 'titular',
            prova: 'documento',
            por: CONFERENTE,
            conferir: () => null,
          },
          trilha,
        ),
      est,
    );
    // A leitura do documento pelo portal, como a operação do portal grava a trilha (evento e paciente nos dados).
    await gravar(async () => null, est, {
      evento: 'portal.documento.visto',
      paciente: pac[0],
      usuario: 'SGH.PORTAL.C1',
      idAlvo: '4321',
    });
  }, 120_000);

  afterAll(async () => {
    if (ests.size)
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-portal-l' }, async (e) => {
        for (const id of ests.values()) await limpar(e, id);
        await limparPacientes(e);
      });
    await nucleo.encerrar();
  });

  it('conta: por id, e-mail, convite e paciente; a de outro estabelecimento não é lida', async () => {
    const k = await leituras.conta(C, massa.conta);
    expect(k).toMatchObject({
      id: massa.conta,
      hospital: EST,
      tipo: 'paciente',
      paciente: pac[0],
      prontuario: PRONT[0],
      situacao: 'ativa',
      email: 'pl-a@x.test',
      senhaResumo: 'resumo-senha-sintetico',
      segundoFator: 'envelope-sintetico',
      conviteOrigem: 'recepcao',
      versao: 2,
    });
    expect(k!.conviteUsadoEm).toBeInstanceOf(Date);
    expect((await leituras.contaPorEmail(C, res('pl-email-a')))?.id).toBe(massa.conta);
    expect((await leituras.contaPorConvite(C, res('pl-conv-a')))?.id).toBe(massa.conta);
    expect((await leituras.contaDoPaciente(C, pac[0]!))?.id).toBe(massa.conta);
    expect((await leituras.contaDoPaciente(C2, pac[0]!))?.id).toBe(massa.contaOutra);
    expect(await leituras.conta(C, massa.contaOutra)).toBeNull();
    expect(await leituras.contaPorConvite(C, res('pl-conv-o'))).toBeNull();
    const abertas = await leituras.contasAbertas(C);
    expect(abertas).toEqual([{ conta: massa.conta, paciente: pac[0], versao: 2 }]);
  });

  it('troca do e-mail: pelo código e a pendente da conta', async () => {
    const t = await leituras.trocaEmailPorToken(C, res('pl-tok-1'));
    expect(t).toMatchObject({
      conta: massa.conta,
      emailNovo: 'pl-b@x.test',
      origem: 'portal',
      situacao: 'pendente',
      envio: 'simulador',
      pedidoPor: `SGH.PORTAL.C${massa.conta}`,
    });
    expect((await leituras.trocaEmailPendente(C, massa.conta))?.id).toBe(t!.id);
    expect(await leituras.trocaEmailPorToken(C2, res('pl-tok-1'))).toBeNull();
  });

  it('vínculo: da conta, do titular, por id, ativos e a fila paginada por chegada', async () => {
    const [a, b, d] = massa.vinculos as [number, number, number];
    expect((await leituras.vinculosDaConta(C, massa.contaRes)).map((v) => v.id)).toEqual([d, b, a]);
    expect((await leituras.vinculosDoTitular(C, pac[0]!)).map((v) => v.id)).toEqual([d, b, a]);
    expect(await leituras.vinculo(C, a)).toMatchObject({
      situacao: 'ativo',
      decididoPor: CONFERENTE,
      escopos: ['resultados', 'documentos'],
      validade: '2099-12-31',
      prontuarioTitular: PRONT[0],
      canal: 'balcao',
      versao: 1,
    });
    expect(await leituras.vinculo(C2, a)).toBeNull();
    expect((await leituras.vinculosAtivos(C)).map((v) => v.id)).toEqual([a]);
    const fila = await leituras.filaVinculos(C, { situacao: 'pendente' });
    expect(fila).toMatchObject({ haMais: false });
    expect(fila.itens.map((v) => v.id)).toEqual([b, d]);
    expect((await leituras.filaVinculos(C, { situacao: null, depoisDe: a })).itens.map((v) => v.id)).toEqual([b, d]);
    expect((await leituras.filaVinculos(C, { situacao: null, titulares: [pac[1]!] })).itens).toEqual([]);
  });

  it('consentimento: o revogado mantém a situação e traz a data; domínios do modelo', async () => {
    const [k] = await leituras.consentimentos(C, pac[0]!);
    expect(k).toMatchObject({ id: massa.consentimento, situacao: 3, signatario: 1, versao: '2', canal: 'portal' });
    expect(k!.revogadoEm).not.toBeNull();
    expect(await leituras.consentimentos(C2, pac[0]!)).toEqual([]);
    expect((await leituras.dominiosConsentimento()).revogacoes).toHaveLength(1);
  });

  it('pedidos da conta e a cópia do prontuário (fila e atos)', async () => {
    const ps = await leituras.pedidos(C, massa.conta, pac[0]!);
    expect(ps.map((p) => p.id)).toEqual([massa.pedido, massa.copia]);
    expect(ps[0]).toMatchObject({ tipo: 'compartilhamento', situacao: 'identidade-verificada', decididoEm: null });
    expect(await leituras.pedidos(C, massa.contaRes, pac[0]!)).toEqual([]);
    const fila = await leituras.filaCopias(C, { pendentes: true });
    expect(fila).toHaveLength(1);
    expect(fila[0]).toMatchObject({
      idPedido: massa.copia,
      canal: 'portal',
      idPaciente: pac[0],
      prontuario: PRONT[0],
      solicitante: 'titular',
      legitimidade: true,
      geracoes: 0,
      entregue: false,
      situacao: 'identidade-verificada',
    });
    expect(await leituras.filaCopias(C, { pendentes: false, idPaciente: pac[1]! })).toEqual([]);
    // A fila completa (com a janela dos decididos) e a busca pelo protocolo rodam no banco e acham a mesma cópia.
    expect((await leituras.filaCopias(C, { pendentes: false })).map((x) => x.idPedido)).toEqual([massa.copia]);
    const porProtocolo = await leituras.filaCopias(C, { pendentes: false, protocolo: fila[0]!.protocolo });
    expect(porProtocolo.map((x) => x.idPedido)).toEqual([massa.copia]);
    expect(await leituras.filaCopias(C, { pendentes: false, protocolo: 'NAO-EXISTE' })).toEqual([]);
    expect(await leituras.filaCopias(C2, { pendentes: false, protocolo: fila[0]!.protocolo })).toEqual([]);
    const atos = await leituras.atosCopia(C, massa.copia);
    expect(atos.map((a) => [a.ato, a.usuario])).toEqual([
      ['solicitacao', `SGH.PORTAL.C${massa.conta}`],
      ['legitimidade', CONFERENTE],
    ]);
    expect(await leituras.atosCopia(C2, massa.copia)).toEqual([]);
  });

  it('documentos (nenhum envelope do paciente sintético) e leituras do titular pela trilha', async () => {
    expect(await leituras.documentos(C, pac[0]!, ['receita', 'atestado'], 1)).toEqual({ itens: [], haMais: false });
    const hoje = new Date().toISOString().slice(0, 10);
    const de = massa.inicio.toISOString().slice(0, 10);
    const r = await leituras.leituras(C, pac[0]!, ['portal.documento.visto'], de, hoje);
    expect(r.haMais).toBe(false);
    expect(r.itens.map((l) => [l.evento, l.usuario, l.idAlvo])).toEqual([
      ['portal.documento.visto', 'SGH.PORTAL.C1', '4321'],
    ]);
    expect((await leituras.leituras(C, pac[1]!, ['portal.documento.visto'], de, hoje)).itens).toEqual([]);
  });
});
