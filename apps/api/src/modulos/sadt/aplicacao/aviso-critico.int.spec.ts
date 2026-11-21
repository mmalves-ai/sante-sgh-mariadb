// Aviso de valor crítico na porta própria do SADT, no MariaDB real (cliente f22_o2; massa SINTÉTICA). Contrato de
// efeito: a central lista o aviso do resultado crítico liberado; a comunicação grava a tentativa (canal, destinatário,
// nível) e muda a situação com a versão; a repetida é recusada; o escalonamento só sobe de nível; a faixa crítica nova
// encerra a vigente (o histórico fica); outro estabelecimento não vê nem grava o aviso.
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PortaSadtPropria } from '../porta-propria.js';
import {
  CLIENTE,
  contexto,
  limparMassaSadt,
  linhaTela,
  type MassaSadt,
  montarMassaSadt,
  SEM_BANCO,
} from './copia.spec-util.js';

const codigoDe = (e: unknown) => (e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : String(e));

describe.skipIf(SEM_BANCO)('aviso de valor crítico (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaSadtPropria;
  let m: MassaSadt | null = null;
  const um = (sql: string, p: unknown[]) => nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-s09avi' }, (l) => l.uma(sql, p));

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await montarMassaSadt(nucleo, 'S9A');
    porta = new PortaSadtPropria(nucleo);
  }, 60_000);
  afterAll(async () => {
    await limparMassaSadt(nucleo, m);
    await nucleo.encerrar();
  });

  it('lista, comunica com a tentativa, recusa a repetida e escalona só para cima', async () => {
    const c = contexto(m!);
    const { hoje } = await porta.relogio(c);
    const [a] = await porta.avisos(c, { inicio: hoje, fim: hoje, pendentes: true });
    expect(a).toMatchObject({ id: m!.aviso, exame: m!.itemLiberado, elemento: 'POTASSIO', situacao: 'aguardandoCiencia', nivel: 0 });
    expect(a!.valor).toContain('7.2');
    expect(await porta.avisos(contexto(m!, m!.base.outroEst), { inicio: hoje, fim: hoje })).toEqual([]);
    expect((await porta.liberadosComCritico(c, { desde: new Date(Date.now() - 3_600_000), hoje })).length).toBe(0);

    const escalonar = (nivel: number) =>
      porta.gravarSgh(c, linhaTela(m!, 'sadt.avisoCritico.escalonado', 'aviso_valor_critico', m!.aviso), (g) =>
        g.escalonarAviso({ aviso: m!.aviso, nivel }),
      );
    expect(await escalonar(1)).toBe(true);
    expect(await escalonar(1)).toBe(false);
    const comunicar = (est = m!.base.est) =>
      porta.gravarSgh(contexto(m!, est), linhaTela(m!, 'sadt.avisoCritico.comunicado', 'aviso_valor_critico', m!.aviso), (g) =>
        g.comunicarAviso({
          aviso: m!.aviso,
          canal: m!.canal,
          destinatario: 'Plantão clínico (teste)',
          observacao: null,
          usuario: m!.base.login,
        }),
      );
    expect(codigoDe(await comunicar(m!.base.outroEst).catch((e: unknown) => e))).toBe('aviso-inexistente');
    await comunicar();
    expect(await um('SELECT situacao, nivel_escalonamento, versao FROM aviso_valor_critico WHERE id = ?', [m!.aviso])).toMatchObject({
      situacao: 'comunicado',
      nivel_escalonamento: 1,
      versao: 3,
    });
    expect(
      await um('SELECT sequencia, resultado, nivel_escalonamento FROM aviso_valor_critico_tentativa WHERE aviso_valor_critico_id = ?', [
        m!.aviso,
      ]),
    ).toMatchObject({ sequencia: 1, resultado: 'comunicado', nivel_escalonamento: 1 });
    expect(codigoDe(await comunicar().catch((e: unknown) => e))).toBe('aviso-comunicado');
    const [depois] = await porta.avisos(c, { inicio: hoje, fim: hoje });
    expect(depois).toMatchObject({ situacao: 'comCiencia', comunicado: { destinatario: 'Plantão clínico (teste)' } });
  });

  it('o aviso vai ao solicitante da requisição, não ao profissional do atendimento (executante)', async () => {
    const c = contexto(m!);
    const req = await um('SELECT solicitante_profissional_id AS s FROM requisicao_exame WHERE id = ?', [m!.requisicao]);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-s09avi' }, (e) =>
      e.executar('UPDATE requisicao_exame SET solicitante_profissional_id = ? WHERE id = ?', [m!.base.profissional2, m!.requisicao]),
    );
    try {
      const at = await um('SELECT profissional_id AS p FROM atendimento WHERE id = ?', [m!.base.atendimento]);
      expect(Number(at?.['p'])).not.toBe(m!.base.profissional2);
      expect(await porta.destinatarioDoCritico(c, m!.itemLiberado)).toBe(m!.base.login2);
      expect(await porta.destinatarioDoCritico(contexto(m!, m!.base.outroEst), m!.itemLiberado)).toBeNull();
      // O usuário do solicitante bloqueado não recebe (o aviso segue no painel do setor).
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-s09avi' }, (e) =>
        e.executar("UPDATE usuario SET situacao = 'inativo' WHERE id = ?", [m!.base.usuario2]),
      );
      expect(await porta.destinatarioDoCritico(c, m!.itemLiberado)).toBeNull();
    } finally {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-s09avi' }, (e) =>
        e.executar('UPDATE requisicao_exame SET solicitante_profissional_id = ? WHERE id = ?', [req?.['s'], m!.requisicao]),
      );
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-s09avi' }, (e) =>
        e.executar("UPDATE usuario SET situacao = 'ativo' WHERE id = ?", [m!.base.usuario2]),
      );
    }
  });

  it('a faixa crítica nova encerra a vigente; a sem limite é recusada; a da unidade sobrepõe a da rede', async () => {
    const c = contexto(m!);
    // Regra da rede (estabelecimento nulo) semeada para o mesmo exame e analito.
    const rede = await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-s09avi' }, (e) =>
      e.inserir(
        `INSERT INTO regra_valor_critico (estabelecimento_id, exame_id, analito_id, limite_superior, vigencia_inicio, ativo, criado_em, versao)
         VALUES (NULL, ?, ?, 7, CURRENT_DATE, TRUE, NOW(3), 1)`,
        [m!.exameLab, m!.analito],
      ),
    );
    expect((await porta.valoresCriticos(c)).filter((v) => v.exame === m!.exameLabCodigo).map((v) => v.id)).toEqual([rede]);
    const gravar = (acimaDe: number | null) =>
      porta.gravarSgh(c, (id: number) => linhaTela(m!, 'sadt.valorCritico.alterado', 'regra_valor_critico', id), (g) =>
        g.gravarValorCritico({
          ato: 15,
          exame: m!.exameLabCodigo,
          elemento: m!.analito,
          abaixoDe: null,
          acimaDe,
          prazoMinutos: 30,
          aprovacao: 'teste',
          ativo: true,
          usuario: m!.base.login,
        }),
      );
    const primeira = await gravar(6);
    const segunda = await gravar(6.5);
    expect(codigoDe(await gravar(null).catch((e: unknown) => e))).toBe('faixa-vazia');
    expect(await um('SELECT ativo, vigencia_fim IS NOT NULL AS encerrada FROM regra_valor_critico WHERE id = ?', [primeira])).toMatchObject({
      ativo: 0,
      encerrada: 1,
    });
    const vigentes = await porta.valoresCriticos(c);
    expect(vigentes.filter((v) => v.exame === m!.exameLabCodigo).map((v) => v.id)).toEqual([segunda]);
    expect(vigentes.find((v) => v.id === segunda)).toMatchObject({ acimaDe: 6.5, elemento: m!.analito, prazoMinutos: 30 });
    // A regra da rede não foi encerrada: segue vigente para as outras unidades.
    expect(await um('SELECT vigencia_fim IS NULL AS vigente FROM regra_valor_critico WHERE id = ?', [rede])).toMatchObject({ vigente: 1 });
    expect(
      (await porta.valoresCriticos(contexto(m!, m!.base.outroEst))).filter((v) => v.exame === m!.exameLabCodigo).map((v) => v.id),
    ).toEqual([rede]);
  });
});
