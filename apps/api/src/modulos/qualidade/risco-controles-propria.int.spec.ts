// C2-060: contrato de efeito dos controles do risco na matriz GUT, contra o MariaDB do cliente de teste
// (SGH_CLIENTE_TESTE). O texto livre dos controles fica em risco_institucional.controles_descricao; a lista estruturada
// liga cada nome ao catálogo do hospital (controle_risco, pela chave do nome normalizado) e grava o vínculo com a
// eficácia e a data da avaliação (risco_institucional_controle). O vínculo que sai da lista recebe exclusão lógica e
// volta reativado; a avaliação só muda de data quando a eficácia muda. Só dados sintéticos.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TrilhaDaGravacao } from '../exames/public-api.js';
import {
  CLIENTE_QUA,
  ctxBanco,
  encerrarMassaQualidade,
  type MassaQualidade,
  prepararMassaQualidade,
  SEM_BANCO_QUA,
} from './massa.spec-util.js';
import { codigoControleRisco, PortaGestaoPropria } from './porta-gestao-propria.js';
import type { RiscoNovo } from './tipos.js';

const T: TrilhaDaGravacao = {
  estabelecimento: null,
  usuario: null,
  acao: 'operacao',
  entidade: 'risco_institucional',
  entidadeId: null,
  correlacao: 'teste-c2-060-controles',
};

describe.skipIf(SEM_BANCO_QUA)(`controles do risco no MariaDB (${CLIENTE_QUA})`, () => {
  let m: MassaQualidade;
  let porta: PortaGestaoPropria;
  let c: ReturnType<typeof ctxBanco>;
  let agora: string;
  const risco = (x: Partial<RiscoNovo> = {}): RiscoNovo => ({
    id: null,
    versao: null,
    titulo: 'Queda de paciente no banho',
    descricao: 'Risco sintético de queda no banho sem barra de apoio.',
    area: 'posto sintetico',
    categoria: 'assistencial',
    gravidade: 3,
    urgencia: 3,
    tendencia: 2,
    controles: null,
    responsavel: m.loginGestor,
    situacao: 'emTratamento',
    reavaliarEm: '2027-01-31',
    justificativa: null,
    agora,
    usuario: m.login,
    ...x,
  });
  const vinculos = (riscoId: number) =>
    m.nucleo.lerSomente({ cliente: CLIENTE_QUA, correlacao: 'leitura-c2-060' }, (l) =>
      l.consultar<{
        codigo: string;
        tipo_controle: string;
        eficacia: string;
        avaliado: number;
        excluido: number;
      }>(
        `SELECT co.codigo, co.tipo_controle, rc.eficacia, rc.avaliado_em IS NOT NULL AS avaliado,
                rc.excluido_em IS NOT NULL AS excluido
           FROM risco_institucional_controle rc JOIN controle_risco co ON co.id = rc.controle_risco_id
          WHERE rc.risco_institucional_id = ? ORDER BY co.nome`,
        [riscoId],
      ),
    );

  beforeAll(async () => {
    m = await prepararMassaQualidade('K6');
    porta = new PortaGestaoPropria(m.nucleo);
    c = ctxBanco(m.est, m.codigoEst, m.usuario);
    agora = await porta.relogio(c);
    await m.nucleo.escrever({ cliente: CLIENTE_QUA, correlacao: 'preparo-c2-060' }, async (e) => {
      const ja = await e.uma("SELECT id FROM categoria_risco_institucional WHERE codigo = 'assistencial'");
      if (!ja)
        await e.inserir(
          "INSERT INTO categoria_risco_institucional (codigo, descricao, criado_em) VALUES ('assistencial', 'Assistencial', ?)",
          [new Date()],
        );
    });
  }, 60_000);
  afterAll(() => encerrarMassaQualidade(m));

  it('grava o texto livre e a lista estruturada, ligando ao catálogo pela chave do nome', async () => {
    const r = await porta.gravarSgh(c, T, (g) =>
      g.registrarRisco(
        risco({
          controles: 'Ronda de enfermagem a cada 2 horas.',
          controlesLista: [
            { nome: 'Barra de apoio', tipo: 'preventivo', eficacia: 'eficaz' },
            { nome: 'Alarme de chamada', tipo: 'detectivo', eficacia: 'naoAvaliado' },
          ],
        }),
      ),
    );
    expect(r).toMatchObject({ versao: 1, criado: true });
    const lido = await porta.risco(c, r.id);
    expect(lido?.controles).toBe('Ronda de enfermagem a cada 2 horas.');
    expect(lido?.controlesLista).toEqual([
      { nome: 'Alarme de chamada', tipo: 'detectivo', eficacia: 'naoAvaliado', avaliadoEm: null },
      { nome: 'Barra de apoio', tipo: 'preventivo', eficacia: 'eficaz', avaliadoEm: agora.slice(0, 10) },
    ]);
    expect(await vinculos(r.id)).toEqual([
      {
        codigo: codigoControleRisco('Alarme de chamada'),
        tipo_controle: 'detectivo',
        eficacia: 'nao_avaliado',
        avaliado: 0,
        excluido: 0,
      },
      {
        codigo: codigoControleRisco('Barra de apoio'),
        tipo_controle: 'preventivo',
        eficacia: 'eficaz',
        avaliado: 1,
        excluido: 0,
      },
    ]);

    // Outro risco com o mesmo controle (com outra grafia) reaproveita a linha do catálogo.
    const r2 = await porta.gravarSgh(c, T, (g) =>
      g.registrarRisco(
        risco({
          titulo: 'Queda no corredor',
          controlesLista: [{ nome: '  barra DE apóio ', tipo: 'preventivo', eficacia: 'parcialmenteEficaz' }],
        }),
      ),
    );
    const catalogo = await m.nucleo.lerSomente({ cliente: CLIENTE_QUA, correlacao: 'leitura-c2-060' }, (l) =>
      l.uma<{ total: number }>('SELECT COUNT(*) AS total FROM controle_risco WHERE estabelecimento_id = ?', [
        m.est,
      ]),
    );
    expect(Number(catalogo?.total)).toBe(2);
    expect((await porta.risco(c, r2.id))?.controlesLista).toMatchObject([
      { tipo: 'preventivo', eficacia: 'parcialmenteEficaz' },
    ]);
  });

  it('a lista nova substitui a anterior: o que sai fica excluído (lógico) e volta reativado; ausente mantém', async () => {
    const r = await porta.gravarSgh(c, T, (g) =>
      g.registrarRisco(
        risco({
          titulo: 'Erro de medicação na diluição',
          controlesLista: [
            { nome: 'Dupla checagem', tipo: 'preventivo', eficacia: 'naoAvaliado' },
            { nome: 'Etiqueta de alto alerta', tipo: 'preventivo', eficacia: 'naoAvaliado' },
          ],
        }),
      ),
    );
    // Sai a etiqueta; a dupla checagem é avaliada (a data da avaliação nasce agora).
    const v2 = await porta.gravarSgh(c, T, (g) =>
      g.registrarRisco(
        risco({
          id: r.id,
          versao: 1,
          titulo: 'Erro de medicação na diluição',
          controlesLista: [{ nome: 'Dupla checagem', tipo: 'preventivo', eficacia: 'ineficaz' }],
        }),
      ),
    );
    expect(v2.versao).toBe(2);
    expect((await vinculos(r.id)).map((v) => [v.eficacia, v.avaliado, v.excluido])).toEqual([
      ['ineficaz', 1, 0],
      ['nao_avaliado', 0, 1],
    ]);
    expect((await porta.risco(c, r.id))?.controlesLista.map((x) => x.nome)).toEqual(['Dupla checagem']);

    // Sem a lista (só a reavaliação do GUT), os vínculos ficam como estão.
    const v3 = await porta.gravarSgh(c, T, (g) =>
      g.registrarRisco(risco({ id: r.id, versao: 2, titulo: 'Erro de medicação na diluição', gravidade: 4 })),
    );
    expect(v3.versao).toBe(3);
    expect((await porta.risco(c, r.id))?.controlesLista).toHaveLength(1);

    // A etiqueta volta: o vínculo excluído é reativado (sem linha nova) e o tipo do catálogo acompanha o informado.
    await porta.gravarSgh(c, T, (g) =>
      g.registrarRisco(
        risco({
          id: r.id,
          versao: 3,
          titulo: 'Erro de medicação na diluição',
          controlesLista: [
            { nome: 'Dupla checagem', tipo: 'preventivo', eficacia: 'ineficaz' },
            { nome: 'Etiqueta de alto alerta', tipo: 'detectivo', eficacia: 'eficaz' },
          ],
        }),
      ),
    );
    const finais = await vinculos(r.id);
    expect(finais).toHaveLength(2);
    expect(finais.map((v) => [v.tipo_controle, v.eficacia, v.excluido])).toEqual([
      ['preventivo', 'ineficaz', 0],
      ['detectivo', 'eficaz', 0],
    ]);
    // A lista vazia tira todos os controles (exclusão lógica; o histórico da avaliação fica no banco).
    await porta.gravarSgh(c, T, (g) =>
      g.registrarRisco(
        risco({ id: r.id, versao: 4, titulo: 'Erro de medicação na diluição', controlesLista: [] }),
      ),
    );
    expect((await porta.risco(c, r.id))?.controlesLista).toEqual([]);
    expect((await vinculos(r.id)).every((v) => v.excluido === 1)).toBe(true);
  });
});
