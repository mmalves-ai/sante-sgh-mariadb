// Regra 21 do M52 (cap-07 §7.1.1; fatia F6): o autosserviço vê SÓ o próprio. Prova sobre a cópia (transação DESFEITA):
//   1. dois colaboradores sintéticos ligados a dois usuários ativos da cópia (o login só fica em memória); o "Meu
//      espaço" de cada login devolve o próprio vínculo, e o pedido do vínculo do colega é recusado (`so-o-proprio`),
//      nunca cai no primeiro vínculo que existir; um login sem vínculo não vê colaborador nenhum;
//   2. holerite e férias só com a folha no Sante SGH (chave `pessoas.folha` desligada: a frase de onde consultar);
//   3. a ciência do POP é só do próprio: a do colega é recusada (`ciencia-so-propria`), a segunda ciência na mesma
//      versão também (`ja-ciente`), e o POP sai da lista de pendentes de quem deu ciência, não da do colega;
//   4. no banco: o papel da aplicação só lê e inclui em SGH_PES_POP_CIENCIA (nem UPDATE nem DELETE).
// Só contagens e IDs em memória; CPF da lista sintética, HMAC com chave aleatória.
import { randomBytes } from 'node:crypto';
import { type ChaveGravada, incluirVinculoPesSgh, type PrerequisitoGravado, somenteSgh } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import {
  type AmbienteM27,
  ambienteM27,
  NA_COPIA,
  PODE_ESCREVER,
  usuariosAtivos,
} from '../../acesso/aplicacao/copia.spec-util.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import { fonteConfiguracaoMemoria } from '../../config/public-api.js';
import { MENSAGEM_FOLHA_FORA, ServicoMeuEspaco } from '../autoatendimento/servico-meu-espaco.js';
import { CifraCpf } from '../cifra-cpf.js';
import { portaEscalaNasTransacoes } from '../escala/porta-escala-legado.js';
import { portaPessoasNaTransacao } from '../porta-legado.js';
import { portaPontoNaTransacao } from '../ponto/porta-ponto-legado.js';
import { portaSesmtNaTransacao } from '../sesmt/porta-sesmt-legado.js';
import { portaTreinamentoNaTransacao } from '../treinamento/porta-treinamento-legado.js';
import { ServicoTreinamento } from '../treinamento/servico-treinamento.js';

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
  alteradoEm: '2026-10-26T10:00:00',
});
const cumprido = (recurso: string): PrerequisitoGravado => ({
  recurso,
  tipo: 'aprovacao',
  situacao: 'cumprido',
  validade: null,
  evidencia: 'integração sintética',
  alteradoPor: 'SGH.TESTE',
  alteradoEm: '2026-10-26T10:00:00',
});
const n = (v: unknown) => Number(v ?? 0);
const CPFS = ['12345678909', '98765432100'];
const RECURSOS = ['pessoas.treinamento', 'pessoas.autoatendimento'];

async function codigo(p: Promise<unknown>): Promise<unknown> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ErroProblema);
  return (e as ErroProblema).extras['codigo'];
}

describe('autosserviço: só o próprio (regra 21)', () => {
  describe.skipIf(!NA_COPIA)('na cópia (privilégio)', () => {
    let a: AmbienteM27;
    beforeAll(async () => {
      a = await ambienteM27();
    }, 900_000);
    afterAll(async () => {
      await a?.nucleo.encerrar();
    });

    it('o papel da aplicação só lê e inclui a ciência do POP', async () => {
      const privs = await a.nucleo.lerSomente({ ...a.c, traceId: 'int-m526-priv' }, (l) =>
        l.consultar(
          `SELECT TRIM(RDB$RELATION_NAME) T, RDB$PRIVILEGE P FROM RDB$USER_PRIVILEGES
             WHERE RDB$USER = 'SGH_APLICACAO' AND RDB$RELATION_NAME = 'SGH_PES_POP_CIENCIA'`,
          [],
          { teto: 20 },
        ),
      );
      expect([...new Set(privs.map((x) => String(x['P']).trim()))].sort()).toEqual(['I', 'S']);
    }, 900_000);
  });

  describe.skipIf(!PODE_ESCREVER)('na cópia (transação desfeita)', () => {
    let a: AmbienteM27;
    beforeAll(async () => {
      a = await ambienteM27();
    }, 900_000);
    afterAll(async () => {
      await a?.nucleo.encerrar();
    });

    it('cada login vê só o próprio vínculo; a ciência do POP é só do próprio', async () => {
      const r = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-m526-escopo' }, async (e) => {
        const u = await usuariosAtivos(e);
        const ids: number[] = [];
        for (const login of [u.a, u.b]) {
          const [x] = await e.consultar('SELECT ID_TBUSERS FROM TBUSERS WHERE NOME = ?', [login], {
            teto: 1,
          });
          ids.push(n(x?.['ID_TBUSERS']));
        }
        const [cc] = await e.consultar(
          "SELECT FIRST 1 COD FROM TBCENCUS WHERE COALESCE(SITUACAO, 'A') <> 'I' ORDER BY COD",
          [],
          { teto: 1 },
        );
        const [un] = await e.consultar('SELECT FIRST 1 COD FROM TBUNIDAD WHERE COD > 0 ORDER BY COD', [], {
          teto: 1,
        });
        const s0 = somenteSgh(e);
        const h = a.c.hospital;
        const cifra = new CifraCpf(randomBytes(32));
        const sufixo = Date.now().toString(36);
        const vinculos: number[] = [];
        for (const [i, cpf] of CPFS.entries()) {
          const v = await incluirVinculoPesSgh(s0, {
            hospital: h,
            pessoa: null,
            cpfHmac: cifra.hmac(cpf),
            cpfCifrado: cifra.cifrar(cpf),
            nome: `COLABORADOR SINTETICO M52.6 ${i + 1}`,
            profissional: null,
            usuario: null,
            tipo: 'clt',
            matricula: `SM526-${sufixo}-${i + 1}`,
            cargo: 'Técnico de enfermagem',
            funcao: null,
            cargaSemanal: 36,
            centroCusto: n(cc?.['COD']),
            unidade: n(un?.['COD']),
            setor: null,
            admissao: '2026-01-01',
            por: 'SGH.TESTE',
          });
          await e.executar('UPDATE SGH_PES_VINCULO SET ID_TBUSERS = ? WHERE ID = ?', [ids[i], v.id]);
          vinculos.push(v.id);
        }
        const [vA, vB] = vinculos as [number, number];

        const trilha = new RegistradorTrilhaMemoria();
        const config = fonteConfiguracaoMemoria(trilha, {
          chavesIniciais: () => RECURSOS.map(chave),
          prerequisitosIniciais: () => RECURSOS.map(cumprido),
        });
        const pessoas = portaPessoasNaTransacao(e, a.executor);
        const treinamento = new ServicoTreinamento(
          portaTreinamentoNaTransacao(e),
          pessoas,
          trilha,
          config,
          null,
        );
        const meu = new ServicoMeuEspaco(
          pessoas,
          portaPontoNaTransacao(e),
          portaEscalaNasTransacoes(new Map([[h, e]])),
          portaSesmtNaTransacao(e),
          treinamento,
          trilha,
          config,
          null,
        );
        let k = 0;
        const s = (login: string): SessaoCadastro => ({
          req: {
            headers: { 'idempotency-key': `int-m526-${sufixo}-${++k}` },
            ip: '127.0.0.1',
            sgh: { sessao: { unidadeAtiva: null } },
          } as never,
          hospital: h,
          rede: a.c.rede,
          login,
          porta: a.c,
          pode: () => true,
        });

        const espacoA = await meu.meuEspaco(s(u.a), null);
        const espacoB = await meu.meuEspaco(s(u.b), null);
        const recusaColega = await codigo(meu.meuEspaco(s(u.a), vB));
        const semVinculo = (await meu.meuEspaco(s('SGH.SEM.VINCULO.M526'), null)).colaborador;

        // POP do estabelecimento inteiro, vigente hoje (fuso do hospital).
        const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
        const pop = await treinamento.publicarPop(s('SINT.QUALIDADE'), {
          codigo: `POP-SINT-${sufixo}`.slice(0, 20).toUpperCase(),
          titulo: 'Higiene das mãos (sintético)',
          unidade: null,
          vigencia: hoje,
          resumo: 'Procedimento sintético da integração do autosserviço.',
          referencia: null,
          alteracoes: null,
        });
        const proprioA = (await meu.vinculosDoLogin(s(u.a))).map((v) => v.id);
        const pendenteAntes = (await meu.meuEspaco(s(u.a), null)).pops.some((p) => p.id === pop.id);
        const recusaCienciaColega = await codigo(
          treinamento.ciencia(s(u.a), { pop: pop.id, vinculo: vB }, proprioA),
        );
        const ciencia = await treinamento.ciencia(s(u.a), { pop: pop.id, vinculo: null }, proprioA);
        const recusaDupla = await codigo(
          treinamento.ciencia(s(u.a), { pop: pop.id, vinculo: null }, proprioA),
        );
        const pendenteA = (await meu.meuEspaco(s(u.a), null)).pops.some((p) => p.id === pop.id);
        const pendenteB = (await meu.meuEspaco(s(u.b), null)).pops.some((p) => p.id === pop.id);
        const [nc] = await e.consultar(
          'SELECT COUNT(*) N FROM SGH_PES_POP_CIENCIA WHERE ID_POP = ? AND ID_VINCULO = ?',
          [pop.id, vA],
          { teto: 1 },
        );
        return {
          vA,
          vB,
          espacoA: espacoA.colaborador?.vinculo,
          espacoB: espacoB.colaborador?.vinculo,
          outrosA: espacoA.outrosVinculos.map((x) => x.vinculo),
          folha: espacoA.folha,
          recusaColega,
          semVinculo,
          pendenteAntes,
          recusaCienciaColega,
          ciencia: ciencia.id > 0,
          recusaDupla,
          pendenteA,
          pendenteB,
          ciencias: n(nc?.['N']),
        };
      });
      expect(r.espacoA).toBe(r.vA);
      expect(r.espacoB).toBe(r.vB);
      expect(r.outrosA).not.toContain(r.vB);
      expect(r.folha).toEqual({ disponivel: false, mensagem: MENSAGEM_FOLHA_FORA });
      expect(r.recusaColega).toBe('so-o-proprio');
      expect(r.semVinculo).toBeNull();
      expect(r.pendenteAntes).toBe(true);
      expect(r.recusaCienciaColega).toBe('ciencia-so-propria');
      expect(r.ciencia).toBe(true);
      expect(r.recusaDupla).toBe('ja-ciente');
      expect(r.pendenteA).toBe(false);
      expect(r.pendenteB).toBe(true);
      expect(r.ciencias).toBe(1);
    }, 900_000);
  });
});
