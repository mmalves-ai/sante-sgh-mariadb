// M59-F5 sobre a CÓPIA, sob a trava e numa transação SEMPRE desfeita (desfazendoNaCopia): a API inteira (sessões
// sintéticas do escritório da qualidade, do operador de backup e do auditor; guardas, reautenticação e interceptores)
// com a porta da certificação sobre UMA transação da cópia (portaSbisNaTransacao):
//   - a autoavaliação do mês aberta com todo o catálogo, cada requisito avaliado (concessão onde há concessão vigente,
//     uma não conformidade de documentação), concluir recusado com pendente, a correção registrada, a verificação
//     recusada para a mesma pessoa e aceita para outra, a conclusão apta com a senha e a segunda do mês recusada;
//   - a pré-auditoria: avaliador obrigatório e, sem o desligamento, recusada;
//   - o termo: encerrar recusado (falha fechada: desligamento, contingência ou medida) e o painel com as seis;
//   - o backup verificado: a restauração diária registrada deixa a diária em dia;
//   - a exportação para a auditoria (CSV e XML) com a identificação lida da cópia e a prova da cadeia do dia;
//   - o ROLLBACK conferido pelas contagens das SGH_AUDIT_* do estabelecimento e dos eventos da trilha do dia.
// Só contagens e códigos na saída (abaixo de 5 vira "<5"); nada de pessoa nem de paciente.
// Rodar: obra-sgh/travas/com-copia.sh ./pnpm exec vitest run --config apps/api/vitest.integracao.config.ts sbis
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  type CicloSbisDetalhe,
  type PainelConcessoes,
  type PainelSbis,
  REQUISITOS_SBIS,
} from '@sgh/contratos';
import {
  type Leitor,
  lerCiclosSbis,
  lerConcessoes,
  lerRestauracoes,
  verificarCadeiaDosDias,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../../app.js';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../../configuracao.js';
import { envTeste, SENHA } from '../../../sessao/teste.spec-util.js';
import { type AmbienteM27, ambienteM27, PODE_ESCREVER } from '../../acesso/aplicacao/copia.spec-util.js';
import { portaSbisNaTransacao } from './porta-legado.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const mascara = (x: number) => (x > 0 && x < 5 ? '<5' : String(x));
const passo = (s: string) => console.log(`[m59.5] ${s}`);
type Resp = { statusCode: number; body: string; headers: Record<string, unknown> };

/** O retrato pelas leituras do @sgh/legado (só ele fala SQL): ciclos, restaurações e concessões do estabelecimento e
 * os eventos da trilha de hoje (a trilha é grande: só o dia, pelo índice). */
async function contagens(l: Leitor, cod: string): Promise<number[]> {
  const hoje = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
  // A trilha das gravações leva o estabelecimento da sessão sintética (`aa`); as linhas SGH_AUDIT_*, o da cópia.
  const [dia] = await verificarCadeiaDosDias(l, 'aa', [hoje]);
  return [
    (await lerCiclosSbis(l, cod, 500)).length,
    (await lerRestauracoes(l, cod)).length,
    (await lerConcessoes(l, cod)).length,
    dia?.linhas ?? 0,
  ];
}

describe.skipIf(!PODE_ESCREVER)('certificação SBIS pela API sobre a cópia (M59-F5)', () => {
  let a: AmbienteM27;
  let antes: number[];
  beforeAll(async () => {
    a = await ambienteM27();
    antes = await a.nucleo.lerSomente({ ...a.c, traceId: 'int-m59-5' }, (l) => contagens(l, a.cod));
  }, 900_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('autoavaliação completa, pré-auditoria, termo, backup e exportação; tudo desfeito', async () => {
    const r = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-m59-5-sbis' }, async (e) => {
      const app: NestFastifyApplication = await criarApp(lerConfiguracao(env), null, env, {
        trilha: new RegistradorTrilhaMemoria(),
        sbis: portaSbisNaTransacao(e, a.cod),
        vigiaEnfermagem: null,
        vigia: null,
      });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      let seq = 0;
      const entrar = async (login: string) => {
        const s = await app.inject({
          method: 'POST',
          url: '/api/sessao',
          payload: { estabelecimento: 'aa', login, senha: SENHA },
        });
        expect(s.statusCode, s.body.slice(0, 200)).toBe(201);
        const set = s.headers['set-cookie'] as string[];
        return {
          cookie: set.map((c) => c.split(';')[0]).join('; '),
          csrf:
            set
              .find((c) => c.startsWith('sgh_csrf='))
              ?.split(';')[0]
              ?.slice(9) ?? '',
        };
      };
      try {
        const q1 = await entrar('SINT.SBIS.CONFORMIDADE');
        const q2 = await entrar('SINT.SBIS.CONFORMIDADE2');
        const bk = await entrar('SINT.SBIS.BACKUP');
        const au = await entrar('SINT.AUDITOR');
        const ad = await entrar('SINT.ADMIN');
        const get = (s: { cookie: string }, url: string) =>
          app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: s.cookie } }) as Promise<Resp>;
        const post = (s: { cookie: string; csrf: string }, url: string, payload: unknown = {}) =>
          app.inject({
            method: 'POST',
            url: `/api${url}`,
            headers: {
              cookie: s.cookie,
              'x-csrf': s.csrf,
              'idempotency-key': `int-m59-5-${String(++seq)}-${Date.now()}`,
            },
            payload: payload as object,
          }) as Promise<Resp>;
        const ok = <T = Record<string, unknown>>(x: Resp) => {
          expect(x.statusCode, x.body.slice(0, 300)).toBeLessThan(300);
          return JSON.parse(x.body) as T;
        };
        const codigo = (x: Resp) => (JSON.parse(x.body) as { codigo?: string }).codigo;

        // ── painel ──
        const painel = ok<PainelSbis>(await get(q1, '/administracao/auditoria/sbis'));
        expect(painel.requisitos.total).toBe(REQUISITOS_SBIS.length);
        expect(painel.pacote).toHaveLength(10);
        passo(`painel: ${painel.requisitos.total} requisitos; desligado=${painel.desligado}`);
        // O auditor lê, mas não conduz (segregação).
        ok(await get(au, '/administracao/auditoria/sbis'));
        expect(
          (await post(au, '/administracao/auditoria/sbis/ciclos', { tipo: 'autoavaliacao', versao: 'x' }))
            .statusCode,
        ).toBe(403);

        // ── autoavaliação ──
        const aberto = ok<CicloSbisDetalhe>(
          await post(q1, '/administracao/auditoria/sbis/ciclos', {
            tipo: 'autoavaliacao',
            versao: '1.0.0-int',
          }),
        );
        expect(aberto.itens).toHaveLength(REQUISITOS_SBIS.length);
        expect(aberto.itens.every((i) => i.resultado === 'pendente')).toBe(true);
        const base = `/administracao/auditoria/sbis/ciclos/${aberto.id}`;
        expect(
          codigo(
            await post(q1, '/administracao/auditoria/sbis/ciclos', { tipo: 'autoavaliacao', versao: '1' }),
          ),
        ).toBe('ciclo-aberto-do-tipo');
        const nc = REQUISITOS_SBIS.find((x) => !x.concessao)!.codigo;
        let concessoes = 0;
        for (const req of REQUISITOS_SBIS) {
          const corpo =
            req.codigo === nc
              ? {
                  resultado: 'nao-conforme',
                  severidade: 'menor',
                  origem: 'documentacao',
                  evidencia: 'manual sem a seção',
                }
              : req.concessao
                ? { resultado: 'concessao' }
                : { resultado: 'conforme', evidencia: 'teste de integração' };
          if (req.concessao) concessoes++;
          ok(await post(q1, `${base}/itens/${req.codigo}`, corpo));
          if (req === REQUISITOS_SBIS[0])
            expect(
              codigo(
                await post(q1, `${base}/concluir`, { parecerTexto: 'parecer antecipado', senha: SENHA }),
              ),
            ).toBe('itens-pendentes');
        }
        passo(`avaliados: ${REQUISITOS_SBIS.length} (concessão ${mascara(concessoes)}, NC 1)`);
        expect(codigo(await post(q1, `${base}/itens/${nc}/verificar`))).toBe('correcao-nao-corrigida');
        ok(await post(q1, `${base}/itens/${nc}/corrigir`, { descricao: 'seção incluída no manual' }));
        expect(codigo(await post(q1, `${base}/itens/${nc}/verificar`))).toBe('verificador-igual');
        ok(await post(q2, `${base}/itens/${nc}/verificar`));
        expect(
          codigo(
            await post(q1, `${base}/concluir`, {
              parecerTexto: 'autoavaliação do mês',
              certificado: 'X-1',
              senha: SENHA,
            }),
          ),
        ).toBe('certificado-so-na-auditoria');
        expect(
          (await post(q1, `${base}/concluir`, { parecerTexto: 'autoavaliação do mês', senha: 'errada' }))
            .statusCode,
        ).toBe(401);
        const concluido = ok<CicloSbisDetalhe>(
          await post(q1, `${base}/concluir`, { parecerTexto: 'autoavaliação do mês', senha: SENHA }),
        );
        expect(concluido.situacao).toBe('concluido');
        expect(concluido.parecer).toBe('apto');
        expect(concluido.itens.find((i) => i.requisito === nc)?.correcao).toBe('verificada');
        expect(
          codigo(
            await post(q1, '/administracao/auditoria/sbis/ciclos', { tipo: 'autoavaliacao', versao: '1' }),
          ),
        ).toBe('autoavaliacao-do-mes');

        // ── pré-auditoria ──
        expect(
          codigo(
            await post(q1, '/administracao/auditoria/sbis/ciclos', { tipo: 'pre-auditoria', versao: '1' }),
          ),
        ).toBe('avaliador-obrigatorio');
        const pre = await post(q1, '/administracao/auditoria/sbis/ciclos', {
          tipo: 'pre-auditoria',
          versao: '1',
          avaliador: 'Consultoria sintética',
        });
        if (painel.desligado) expect(pre.statusCode).toBe(201);
        else expect(codigo(pre)).toBe('sistema-anterior-ligado');
        passo(`pré-auditoria: ${pre.statusCode}`);

        // ── termo das concessões ──
        const termo = ok<PainelConcessoes>(await get(ad, '/administracao/coexistencia/concessoes'));
        expect(termo.concessoes).toHaveLength(6);
        expect(termo.vigentes).toBe(6);
        // Falha fechada: sem desligamento concluído, contingência fechada e medida atendida, nenhuma concessão encerra.
        const enc = await post(ad, '/administracao/coexistencia/concessoes/senha-formato-antigo/encerrar', {
          evidencia: 'senhas regravadas no esquema forte',
          senha: SENHA,
        });
        expect(enc.statusCode, enc.body.slice(0, 300)).toBe(409);
        expect([
          'sistema-anterior-ligado',
          'contingencia-ativa',
          'indicador-pendente',
          'indicador-indisponivel',
        ]).toContain(codigo(enc));
        ok(
          await post(ad, '/administracao/coexistencia/concessoes/senha-formato-antigo/previsao', {
            fimPrevisto: '2027-06-30',
          }),
        );
        const termo2 = ok<PainelConcessoes>(await get(ad, '/administracao/coexistencia/concessoes'));
        expect(termo2.concessoes.find((c) => c.codigo === 'senha-formato-antigo')?.fimPrevisto).toBe(
          '2027-06-30',
        );
        passo(
          `termo: ${termo.vigentes} vigentes; encerrar recusado (${codigo(enc) ?? '?'}); previsão gravada`,
        );

        // ── backup verificado ──
        const fim = new Date(Date.now() - 3_600_000);
        const inicio = new Date(fim.getTime() - 40 * 60_000);
        ok(
          await post(bk, '/administracao/auditoria/backup/restauracoes', {
            tipo: 'diaria',
            inicio: inicio.toISOString(),
            fim: fim.toISOString(),
            resultado: 'ok',
            integridade: 'ok',
            tamanhoMb: 1024,
            ambiente: 'servidor de teste',
          }),
        );
        const backup = ok<{ diaria: { emDia: boolean }; restauracoes: unknown[]; destino: string }>(
          await get(bk, '/administracao/auditoria/backup'),
        );
        expect(backup.destino).toBe('legado');
        expect(backup.diaria.emDia).toBe(true);
        expect(backup.restauracoes.length).toBeGreaterThan(0);

        // ── exportação para a auditoria ──
        const hoje = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
        const csv = await get(
          au,
          `/administracao/auditoria/trilha/exportar-sbis?formato=csv&inicio=${hoje}&fim=${hoje}`,
        );
        expect(csv.statusCode, csv.body.slice(0, 200)).toBe(200);
        expect(csv.body).toMatch(/^"?# /);
        expect(['sim', 'nao']).toContain(csv.headers['x-cadeia-integra']);
        const xml = await get(
          au,
          `/administracao/auditoria/trilha/exportar-sbis?formato=xml&inicio=${hoje}&fim=${hoje}`,
        );
        expect(xml.statusCode).toBe(200);
        expect(xml.body).toContain('<identificacao ');
        expect(xml.body).toContain('<provaCadeia ');
        expect(xml.body).toMatch(/estabelecimento="[^"]+"/);
        passo(`exportação: cadeia íntegra=${String(csv.headers['x-cadeia-integra'])}`);

        return await contagens(e, a.cod);
      } finally {
        await app.close();
      }
    });
    const dentro = r;
    expect(dentro[0]).toBeGreaterThan(antes[0] ?? 0);
    expect(dentro[1]).toBeGreaterThan(antes[1] ?? 0);
    expect(dentro[3]).toBeGreaterThan(antes[3] ?? 0);
    const depois = await a.nucleo.lerSomente({ ...a.c, traceId: 'int-m59-5' }, (l) => contagens(l, a.cod));
    expect(depois).toEqual(antes);
    passo('ROLLBACK: ciclos, restaurações, concessões e a trilha do dia iguais');
  }, 900_000);
});
