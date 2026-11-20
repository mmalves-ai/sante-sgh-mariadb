// W0-06, parte 6c (programa CRUD completo, M3 de mercado) sobre a cópia (transação DESFEITA): o SQL real do script
// 1067 e das gravações das solicitações do autoatendimento pelo `ServicoAutoatendimento`. Um colaborador sintético
// (CPF só como HMAC de mentira) ligado a um usuário ativo da cópia (o login só fica em memória) pede; o gestor decide:
//   - férias aprovadas viram a programação na SGH_PES_FERIAS na mesma transação (ID_FERIAS na solicitação);
//   - abono aprovado vira um ajuste `justificativa` aprovado por dia, ligado à solicitação; o mesmo dia de novo recusa
//     (`dia-ja-justificado`), a solicitação segue pendente e depois é recusada com o motivo;
//   - ajuste de ponto: só quem pediu desiste (o gestor recebe a recusa; o CHECK SGH_CK_PES_SOLIC_QUEM também recusa
//     a desistência gravada por outra pessoa e a aprovação pelo próprio solicitante); o ajuste desiste junto;
//   - alteração cadastral aprovada corrige o nome com o valor anterior na SGH_PES_CORRECAO;
//   - atestado: o gestor sem a permissão lê sem o CID e pedir o CID é 403; quem tem a permissão lê o CID e a trilha;
//     toda leitura grava SGH_PES_ATESTADO_ACESSO; a aprovação vira os ajustes dos dias.
// Nada do sistema anterior é escrito (somenteSgh) e as contagens das tabelas tocadas voltam iguais depois do ROLLBACK.
import { type ChaveGravada, type PrerequisitoGravado, somenteSgh } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import {
  type AmbienteM27,
  ambienteM27,
  PODE_ESCREVER,
  usuariosAtivos,
} from '../../acesso/aplicacao/copia.spec-util.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import { fonteConfiguracaoMemoria } from '../../config/public-api.js';
import { portaAutoatendimentoNaTransacao } from '../autoatendimento/porta-autoatendimento-legado.js';
import {
  PERMISSOES_AUTOATENDIMENTO,
  ServicoAutoatendimento,
} from '../autoatendimento/servico-autoatendimento.js';
import { CifraCpf } from '../cifra-cpf.js';
import { portaCalculoFolhaNaTransacao } from '../folha/porta-calculo-legado.js';
import { portaFolhaNaTransacao } from '../folha/porta-folha-legado.js';
import { ServicoFeriasFolha } from '../folha/servico-ferias.js';
import { portaPessoasNaTransacao } from '../porta-legado.js';
import { cpfSintetico } from '../porta-memoria.js';
import { portaPontoNaTransacao } from '../ponto/porta-ponto-legado.js';
import { portaRubricasNaTransacao } from '../rubricas/porta-rubricas-legado.js';
import { ServicoPessoas } from '../servico.js';

const chave = (c: string): ChaveGravada => ({
  id: c,
  tipo: 'recurso',
  chave: c,
  escopo: 'hospital',
  valor: '*',
  ligada: true,
  ligadaAntes: null,
  lote: null,
  justificativa: 'integração sintética',
  alteradoPor: 'SGH.TESTE',
  alteradoEm: '2026-11-18T10:00:00',
});
const cumprido = (recurso: string): PrerequisitoGravado => ({
  recurso,
  tipo: 'aprovacao',
  situacao: 'cumprido',
  validade: null,
  evidencia: 'integração sintética',
  alteradoPor: 'SGH.TESTE',
  alteradoEm: '2026-11-18T10:00:00',
});
const n = (v: unknown) => Number(v ?? 0);
const TABELAS = [
  'SGH_PES_SOLICITACAO',
  'SGH_PES_ATESTADO',
  'SGH_PES_ATESTADO_ACESSO',
  'SGH_PES_PONTO_AJUSTE',
  'SGH_PES_FERIAS',
  'SGH_PES_VINCULO',
  'SGH_PES_CORRECAO',
] as const;

async function erro(p: Promise<unknown>) {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).not.toBeNull();
  if (e instanceof ErroProblema) return { codigo: e.extras['codigo'] ?? e.tipo, status: e.getStatus() };
  const x = e as { problema?: { codigo?: string }; message?: string };
  return { codigo: x.problema?.codigo ?? x.message ?? String(e), status: 0 };
}

/** `hoje` mais `d` dias (AAAA-MM-DD). */
function dia(hoje: string, d: number): string {
  const x = new Date(`${hoje}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + d);
  return x.toISOString().slice(0, 10);
}

describe.skipIf(!PODE_ESCREVER)('W0-06: solicitações do autoatendimento (cópia, transação desfeita)', () => {
  let a: AmbienteM27;
  beforeAll(async () => {
    a = await ambienteM27();
  }, 900_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('férias, abono, ajuste e alteração cadastral aprovados com o efeito; recusa; desistência só do próprio (CHECK); atestado com o CID restrito e a trilha', async () => {
    const contar = async (l: {
      consultar: (s: string, p: unknown[], o: { teto: number }) => Promise<Record<string, unknown>[]>;
    }) => {
      const r: Record<string, number> = {};
      for (const t of TABELAS) {
        const [x] = await l.consultar(`SELECT COUNT(*) N FROM ${t}`, [], { teto: 1 });
        r[t] = n(x?.['N']);
      }
      return r;
    };
    const antes = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-w006-6-antes' }, (e) => contar(e));
    const r = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-w006-6-solic' }, async (e) => {
      const s0 = somenteSgh(e);
      const COLAB = (await usuariosAtivos(e)).a;
      const [u] = await e.consultar('SELECT ID_TBUSERS FROM TBUSERS WHERE NOME = ?', [COLAB], { teto: 1 });
      const [cc] = await e.consultar(
        "SELECT FIRST 1 COD FROM TBCENCUS WHERE COALESCE(SITUACAO, 'A') <> 'I' ORDER BY COD",
        [],
        { teto: 1 },
      );
      const ctx = { rede: a.c.rede, hospital: a.c.hospital };
      const folha = portaFolhaNaTransacao(e);
      const empresa = (await folha.empresas(ctx))[0]!.codigo;
      const trilha = new RegistradorTrilhaMemoria();
      const recursos = ['pessoas.colaborador', 'pessoas.ponto', 'pessoas.folha'];
      const config = fonteConfiguracaoMemoria(trilha, {
        chavesIniciais: () => recursos.map(chave),
        prerequisitosIniciais: () => recursos.map(cumprido),
      });
      const pessoas = portaPessoasNaTransacao(e, a.executor);
      const ponto = portaPontoNaTransacao(e);
      const ferias = new ServicoFeriasFolha(
        portaCalculoFolhaNaTransacao(e),
        folha,
        portaRubricasNaTransacao(e),
        pessoas,
        trilha,
        config,
        null,
      );
      const porta = portaAutoatendimentoNaTransacao(e);
      const svc = new ServicoAutoatendimento(porta, pessoas, ponto, ferias, trilha, config, null);
      const rh = new ServicoPessoas(pessoas, trilha, config, null, new CifraCpf(Buffer.alloc(32, 68)));
      let k = 0;
      const sufixo = Date.now().toString(36);
      const s = (login = 'SGH.RH', pode: (p: string) => boolean = () => true): SessaoCadastro => ({
        req: {
          headers: { 'idempotency-key': `int-w006-6-${sufixo}-${++k}` },
          ip: '127.0.0.1',
          sgh: { sessao: { unidadeAtiva: null } },
        } as never,
        hospital: a.c.hospital,
        rede: a.c.rede,
        login,
        porta: a.c,
        pode,
      });
      const eu = () => s(COLAB);
      const gestorSemCid = () => s('SGH.GESTOR', (p) => p !== PERMISSOES_AUTOATENDIMENTO.verCid);
      const decidir = (
        solicitacao: number,
        versao: number,
        decisao: 'aprovar' | 'recusar',
        motivo: string | null,
      ) => ({
        solicitacao,
        versao,
        decisao,
        motivo,
        movimento: null,
        justificativa: null,
        empresa,
        aquisitivoInicio: null,
      });
      const linha = async (id: number) => {
        const [x] = await e.consultar(
          `SELECT SITUACAO, PEDIDO_POR, DECIDIDO_POR, ID_FERIAS FROM SGH_PES_SOLICITACAO
             WHERE ID = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)`,
          [String(id)],
          { teto: 1 },
        );
        return {
          situacao: String(x?.['SITUACAO']).trim(),
          pedidoPor: String(x?.['PEDIDO_POR']).trim(),
          decididoPor: x?.['DECIDIDO_POR'] == null ? null : String(x['DECIDIDO_POR']).trim(),
          ferias: x?.['ID_FERIAS'] == null ? null : n(x['ID_FERIAS']),
        };
      };
      const ajustesLigados = async (id: number) =>
        (
          await e.consultar(
            `SELECT SITUACAO FROM SGH_PES_PONTO_AJUSTE WHERE ID_SOLICITACAO = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)
               ORDER BY ID`,
            [String(id)],
            { teto: 40 },
          )
        ).map((x) => String(x['SITUACAO']).trim());
      const banco = (sql: string, p: unknown[]) =>
        s0.executar(sql, p).then(
          () => 'passou',
          () => 'recusou',
        );

      // 0. Colaborador sintético admitido em 2025-06-02 (aquisitivo vencido), ligado ao usuário da cópia.
      const hoje = await porta.hoje(a.c);
      const vinculo = (
        await rh.admitir(s(), {
          cpf: cpfSintetico('900606690'),
          nome: 'SOLICITANTE SINTETICA W0-06',
          tipo: 'clt',
          admissao: '2025-06-02',
          cargo: 'Auxiliar administrativo',
          funcao: null,
          cargaSemanalHoras: 44,
          lotacao: { centroCusto: n(cc?.['COD']), unidade: null, setor: null },
          matricula: `SINT-W006-S-${sufixo}`.slice(0, 20),
          profissional: null,
          usuario: null,
        })
      ).id;
      await s0.executar(
        `UPDATE SGH_PES_VINCULO SET ID_TBUSERS = ? WHERE ID = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)`,
        [n(u?.['ID_TBUSERS']), String(vinculo)],
      );
      const doLogin = await ponto.vinculosDoLogin(a.c, COLAB);

      // 1. Férias: a segunda-feira depois de hoje + 45 dias; o próprio não decide; o gestor aprova e programa.
      let inicioFerias = dia(hoje, 45);
      while (new Date(`${inicioFerias}T12:00:00Z`).getUTCDay() !== 1) inicioFerias = dia(inicioFerias, 1);
      const fe = await svc.incluir(eu(), {
        tipo: 'ferias',
        vinculo: null,
        inicio: inicioFerias,
        diasGozo: 20,
        diasAbono: 10,
        adiantaDecimo: false,
        observacao: null,
      });
      const feProprio = await erro(svc.decidir(eu(), decidir(fe.id, 0, 'aprovar', null)));
      const feOk = await svc.decidir(s(), decidir(fe.id, 0, 'aprovar', null));
      const [feRow] = await e.consultar(
        `SELECT ID_VINCULO, GOZO_INICIO, DIAS_GOZO, DIAS_ABONO, SITUACAO FROM SGH_PES_FERIAS WHERE ID = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)`,
        [String(feOk.solicitacao!.ferias)],
        { teto: 1 },
      );

      // 2. Abono de dois dias aprovado: um ajuste aprovado por dia, ligado; o mesmo dia de novo recusa e fica pendente.
      const abono = (inicio: string, fim: string) =>
        ({
          tipo: 'abono',
          vinculo: null,
          inicio,
          fim,
          movimento: 7,
          justificativa: null,
          observacao: 'Pedido sintético da integração',
        }) as const;
      const ab = await svc.incluir(eu(), abono(dia(hoje, -10), dia(hoje, -9)));
      const abOk = await svc.decidir(s(), decidir(ab.id, 0, 'aprovar', 'Combinado com a chefia'));
      const ab2 = await svc.incluir(eu(), abono(dia(hoje, -9), dia(hoje, -9)));
      const ab2Dup = await erro(svc.decidir(s(), decidir(ab2.id, 0, 'aprovar', null)));
      const ab2Pendente = await linha(ab2.id);
      const ab2Ajustes = await ajustesLigados(ab2.id);
      const ab2Rec = await svc.decidir(s(), decidir(ab2.id, 0, 'recusar', 'O dia já estava abonado'));

      // 3. Ajuste de ponto: o gestor não desiste pelo colaborador; o próprio desiste e o ajuste desiste junto.
      const pedidoAjuste = {
        tipo: 'ajuste_ponto',
        vinculo: null,
        dia: dia(hoje, -5),
        ajuste: 'justificativa',
        marcacao: null,
        instante: null,
        movimento: 7,
        justificativa: null,
        periodo: null,
        minutos: 60,
        observacao: 'Consulta sintética da integração',
      } as const;
      const aj = await svc.incluir(eu(), pedidoAjuste);
      const ajLigadoAntes = await ajustesLigados(aj.id);
      const ajGestor = await erro(
        svc.desistir(s(), { solicitacao: aj.id, versao: 0, motivo: 'Não fui eu quem pediu' }),
      );
      // O banco também recusa: desistência gravada por outra pessoa e aprovação pelo próprio solicitante.
      const ckDesistOutro = await banco(
        `UPDATE SGH_PES_SOLICITACAO SET SITUACAO = 'desistida', DECIDIDO_POR = 'SGH.OUTRO',
           DECIDIDO_EM = CURRENT_TIMESTAMP, MOTIVO_DECISAO = 'Tentativa sintética' WHERE ID = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)`,
        [String(aj.id)],
      );
      const ckAprovaProprio = await banco(
        `UPDATE SGH_PES_SOLICITACAO SET SITUACAO = 'aprovada', DECIDIDO_POR = PEDIDO_POR,
           DECIDIDO_EM = CURRENT_TIMESTAMP WHERE ID = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)`,
        [String(aj.id)],
      );
      const ckRecusaSemMotivo = await banco(
        `UPDATE SGH_PES_SOLICITACAO SET SITUACAO = 'recusada', DECIDIDO_POR = 'SGH.OUTRO',
           DECIDIDO_EM = CURRENT_TIMESTAMP, MOTIVO_DECISAO = NULL WHERE ID = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)`,
        [String(aj.id)],
      );
      const ajDesist = await svc.desistir(eu(), {
        solicitacao: aj.id,
        versao: 0,
        motivo: 'Lancei o dia errado',
      });
      const ajLinha = await linha(aj.id);
      const ajLigadoDepois = await ajustesLigados(aj.id);

      // 4. Alteração cadastral: o nome corrigido com o valor anterior na trilha.
      const alt = await svc.incluir(eu(), {
        tipo: 'alteracao_cadastral',
        vinculo: null,
        campo: 'nome',
        valorNovo: 'SOLICITANTE SINTETICA W0-06 SILVA',
        observacao: 'Casei e mudei o sobrenome',
      });
      await svc.decidir(s(), decidir(alt.id, 0, 'aprovar', null));
      const nomeDepois = (await pessoas.vinculo(a.c, vinculo))?.nome;
      const correcoes = await pessoas.correcoes(a.c, vinculo);

      // 5. Atestado de 20 dias com CID: aviso do INSS; CID restrito; toda leitura vai à trilha; a aprovação vira ajustes.
      const at = await svc.incluir(eu(), {
        tipo: 'atestado',
        vinculo: null,
        inicio: dia(hoje, -3),
        fim: dia(hoje, -2),
        movimento: 7,
        atestado: {
          emitidoEm: dia(hoje, -3),
          dias: 20,
          cid: 'j11.1',
          emitente: 'Médica sintética',
          registroConselho: null,
          arquivo: null,
        },
        observacao: null,
      });
      const atGestor = await svc.atestado(gestorSemCid(), at.id, {
        finalidade: 'Conferir os dias',
        verCid: false,
      });
      const atGestorCid = await erro(
        svc.atestado(gestorSemCid(), at.id, { finalidade: 'Ver o CID', verCid: true }),
      );
      const atEstranho = await erro(
        svc.atestado(
          s('SGH.ESTRANHO', () => false),
          at.id,
          { finalidade: 'Curiosidade', verCid: false },
        ),
      );
      const atProprio = await svc.atestado(eu(), at.id, { finalidade: 'Conferir o meu', verCid: true });
      const atSesmt = await svc.atestado(s('SGH.SESMT'), at.id, {
        finalidade: 'Nexo com o trabalho',
        verCid: true,
      });
      const [acessos] = await e.consultar(
        `SELECT COUNT(*) N FROM SGH_PES_ATESTADO_ACESSO WHERE ID_ATESTADO = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)`,
        [String(atSesmt.id)],
        { teto: 1 },
      );
      const atOk = await svc.decidir(s(), decidir(at.id, 0, 'aprovar', null));

      // 6. As listas: a fila do gestor e as do próprio.
      const minhas = await svc.minhas(eu(), {});
      const fila = await svc.fila(s(), { situacao: 'pendente' });

      return {
        vinculo,
        doLogin,
        fe: { pedido: fe.solicitacao, proprio: feProprio, ok: feOk.solicitacao, linha: await linha(fe.id) },
        feRow: {
          vinculo: n(feRow?.['ID_VINCULO']),
          dias: n(feRow?.['DIAS_GOZO']),
          abono: n(feRow?.['DIAS_ABONO']),
          situacao: String(feRow?.['SITUACAO']).trim(),
        },
        inicioFerias,
        abOk: abOk.solicitacao,
        abLigados: await ajustesLigados(ab.id),
        ab2Dup,
        ab2Pendente,
        ab2Ajustes,
        ab2Rec: ab2Rec.solicitacao,
        ajLigadoAntes,
        ajGestor,
        ckDesistOutro,
        ckAprovaProprio,
        ckRecusaSemMotivo,
        ajDesist: ajDesist.solicitacao,
        ajLinha,
        ajLigadoDepois,
        alt: alt.solicitacao,
        nomeDepois,
        ultimaCorrecao: correcoes.at(-1),
        atAvisos: at.avisos,
        atGestor,
        atGestorCid,
        atEstranho,
        atProprio,
        atSesmt,
        acessos: n(acessos?.['N']),
        atOk: atOk.solicitacao,
        atLigados: await ajustesLigados(at.id),
        minhas: minhas.itens.map((x) => [x.tipo, x.situacao]),
        filaDoVinculo: fila.itens.filter((x) => x.vinculo === vinculo).length,
      };
    });

    expect(r.doLogin).toContain(r.vinculo);
    // Férias
    expect(r.fe.pedido).toMatchObject({ situacao: 'pendente', vinculo: r.vinculo, ferias: null });
    expect(r.fe.proprio.codigo).toBe('solicitacao-decisao-pelo-solicitante');
    expect(r.fe.ok).toMatchObject({ situacao: 'aprovada', decididoPor: 'SGH.RH' });
    expect(r.fe.ok!.ferias).toBeGreaterThan(0);
    expect(r.fe.linha).toMatchObject({ situacao: 'aprovada', ferias: r.fe.ok!.ferias });
    expect(r.feRow).toMatchObject({ vinculo: r.vinculo, dias: 20, abono: 10, situacao: 'programada' });
    // Abono
    expect(r.abOk!.ajustes.map((x) => x.situacao)).toEqual(['aprovado', 'aprovado']);
    expect(r.abLigados).toEqual(['aprovado', 'aprovado']);
    expect(r.ab2Dup.codigo).toBe('dia-ja-justificado');
    expect(r.ab2Pendente.situacao).toBe('pendente');
    expect(r.ab2Ajustes).toEqual([]);
    expect(r.ab2Rec).toMatchObject({ situacao: 'recusada', motivoDecisao: 'O dia já estava abonado' });
    // Ajuste e desistência
    expect(r.ajLigadoAntes).toEqual(['pendente']);
    expect(r.ajGestor.codigo).toBe('solicitacao-desistencia-so-do-solicitante');
    expect([r.ckDesistOutro, r.ckAprovaProprio, r.ckRecusaSemMotivo]).toEqual([
      'recusou',
      'recusou',
      'recusou',
    ]);
    expect(r.ajDesist).toMatchObject({ situacao: 'desistida', motivoDecisao: 'Lancei o dia errado' });
    expect(r.ajLinha.decididoPor).toBe(r.ajLinha.pedidoPor);
    expect(r.ajLigadoDepois).toEqual(['desistido']);
    // Alteração cadastral
    expect(r.alt).toMatchObject({
      valorAnterior: 'SOLICITANTE SINTETICA W0-06',
      valorNovo: 'SOLICITANTE SINTETICA W0-06 SILVA',
    });
    expect(r.nomeDepois).toBe('SOLICITANTE SINTETICA W0-06 SILVA');
    expect(r.ultimaCorrecao).toMatchObject({
      operacao: 'colaborador.corrigido',
      antes: { nome: 'SOLICITANTE SINTETICA W0-06' },
      depois: { nome: 'SOLICITANTE SINTETICA W0-06 SILVA' },
    });
    // Atestado
    expect(r.atAvisos).toEqual(['atestado-acima-de-15-dias']);
    expect(r.atGestor).toMatchObject({ cid: null, temCid: true, avisoInss: true, acessos: [] });
    expect(r.atGestorCid.status).toBe(403);
    expect(r.atEstranho.status).toBe(404);
    expect(r.atProprio.cid).toBe('J11.1');
    expect(r.atSesmt.cid).toBe('J11.1');
    expect(r.atSesmt.acessos.map((x) => [x.acessadoPor, x.viuCid])).toEqual([
      ['SGH.SESMT', true],
      [expect.any(String), true],
      ['SGH.GESTOR', false],
    ]);
    expect(r.acessos).toBe(3);
    expect(r.atOk).toMatchObject({ situacao: 'aprovada' });
    expect(r.atLigados).toEqual(['aprovado', 'aprovado']);
    // Listas
    expect(r.minhas).toHaveLength(6);
    expect(r.filaDoVinculo).toBe(0);

    const final = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-w006-6-final' }, (e) => contar(e));
    expect(final).toEqual(antes);
    console.log(JSON.stringify({ antes, final }));
  }, 600_000);
});
