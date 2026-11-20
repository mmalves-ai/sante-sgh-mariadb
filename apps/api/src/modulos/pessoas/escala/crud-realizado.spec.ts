// W0-06, parte 2 (programa CRUD completo; aceite 4): o estorno do plantão realizado aprovado, com motivo.
//   - não lançado: só SGH_ (fica fora do repasse);
//   - lançado, com a apuração do repasse da competência já conferida, aprovada ou titulada: 409 `repasse-apurado`,
//     que indica a devolução da apuração, sem gravar nada;
//   - lançado e não apurado: o lançamento negativo pela receita (origem `estorno`, competência seguinte, apontando o
//     original), ligado ao realizado; a receita que recusa desfaz o estorno.
// Portas EM MEMÓRIA; dados SINTÉTICOS.
import type { ChaveGravada, PrerequisitoGravado } from '@sgh/legado';
import { describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import { fonteConfiguracaoMemoria } from '../../config/public-api.js';
import { PortaPessoasMemoria } from '../porta-memoria.js';
import { PortaEscalaMemoria } from './porta-escala-memoria.js';
import { PortaRealizadoMemoria } from './porta-realizado-memoria.js';
import { ServicoRealizado } from './servico-realizado.js';

const chave = (c: string): ChaveGravada => ({
  id: c,
  tipo: 'recurso',
  chave: c,
  escopo: 'hospital',
  valor: '*',
  ligada: true,
  ligadaAntes: null,
  lote: null,
  justificativa: 'teste sintético',
  alteradoPor: 'SINT.ADMIN',
  alteradoEm: '2026-10-25T10:00:00',
});
const cumprido = (recurso: string): PrerequisitoGravado => ({
  recurso,
  tipo: 'aprovacao',
  situacao: 'cumprido',
  validade: null,
  evidencia: 'conferência sintética',
  alteradoPor: 'SINT.ADMIN',
  alteradoEm: '2026-10-25T10:00:00',
});

const ctx = { rede: '', hospital: 'aa' };
let k = 0;
const sessao = (login: string, pode: (c: string) => boolean = () => true): SessaoCadastro =>
  ({
    req: { headers: { 'idempotency-key': `w006-real-${++k}` }, ip: '127.0.0.1', sgh: undefined },
    hospital: 'aa',
    rede: '',
    login,
    porta: ctx,
    pode,
  }) as unknown as SessaoCadastro;

async function codigo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    if (e instanceof ErroProblema) return String(e.extras?.['codigo'] ?? e.tipo);
    return `outro: ${(e as Error).message}`;
  }
}

async function montar() {
  const trilha = new RegistradorTrilhaMemoria();
  const recursos = ['pessoas.plantaoRealizado', 'pessoas.repassePlantao'];
  const config = fonteConfiguracaoMemoria(trilha, {
    chavesIniciais: () => recursos.map(chave),
    prerequisitosIniciais: () => recursos.map(cumprido),
    parametrosIniciais: (hospital) => [
      {
        id: 'teste-w006-evento',
        chave: 'pessoas.repasse.eventoPlantao',
        nivel: 'estabelecimento' as const,
        alvo: hospital,
        valor: '40',
        vigenteDesde: '2026-10-01T00:00:00.000Z',
        vigenteAte: null,
        justificativa: 'Teste sintético do W0-06',
        autor: 'SINT.ADMIN',
      },
    ],
  });
  const pessoas = new PortaPessoasMemoria();
  pessoas.hojeFixo = '2026-11-18';
  const escala = new PortaEscalaMemoria(pessoas);
  const porta = new PortaRealizadoMemoria(escala, pessoas);
  porta.agoraFixo = '2026-11-18T10:00';
  const servico = new ServicoRealizado(porta, pessoas, null, trilha, config, null);
  // Uma escala publicada de outubro com dois plantões (vínculos sintéticos 801 e 802; registro 77 no primeiro).
  const ps = await escala.gravarSgh(ctx, {} as never, async (g) => {
    const es = await g.incluirEscala({
      unidade: 1,
      setor: 'Posto médico',
      competencia: '2026-10',
      tipo: 'medica',
      cobertura: { manha: 0, tarde: 0, noite: 0 },
      por: 'SINT.ESCALA',
    });
    const base = {
      escala: es,
      profissional: null,
      tipo: 'presencial',
      chegadaMin: null,
      alertaConselho: null,
      redeNaoConferida: false,
      motivo: null,
      por: 'SINT.ESCALA',
    };
    const a = await g.incluirPlantao({
      ...base,
      vinculo: 801,
      pessoa: 8801,
      registro: 77,
      inicio: '2026-10-10T07:00',
      fim: '2026-10-10T19:00',
    });
    const b = await g.incluirPlantao({
      ...base,
      vinculo: 802,
      pessoa: 8802,
      registro: 78,
      inicio: '2026-10-11T07:00',
      fim: '2026-10-11T19:00',
    });
    await g.publicarEscala({ id: es, versao: 0, justificativaFuro: null, por: 'SINT.ESCALA' });
    return [a, b] as const;
  });
  // O realizado aprovado (por outra pessoa), com valor; `lancado` simula o lançamento já feito no repasse.
  const aprovado = async (plantao: number, lancado: number | null) => {
    const id = await porta.gravarSgh(ctx, {} as never, async (g) => {
      const p = (await g.plantao(plantao))!;
      const i = await g.incluirRealizado({
        plantao,
        vinculo: p.vinculo,
        inicio: p.inicio,
        fim: p.fim,
        minutos: 720,
        origem: 'informado',
        observacao: null,
        por: 'SINT.ESCALA',
      });
      await g.decidirRealizado({
        id: i,
        versao: 0,
        situacao: 'aprovado',
        motivo: null,
        tarifa: 1,
        valorHora: 100,
        valor: 1200,
        por: 'SINT.ESCALA.APROVA',
      });
      return i;
    });
    if (lancado !== null) Object.assign((await porta.realizado(ctx, id))!, { lancamento: lancado });
    return id;
  };
  return { porta, servico, ps, aprovado, trilha };
}

describe('estorno do plantão realizado (W0-06, aceite 4)', () => {
  it('não lançado: estorna só no novo, com motivo; fica fora do repasse e a lista mostra quem e por quê', async () => {
    const { porta, servico, ps, aprovado } = await montar();
    const id = await aprovado(ps[0], null);
    const r = await servico.estornar(sessao('SINT.COORD'), {
      realizado: id,
      motivo: 'Plantão registrado no dia errado',
      versao: 1,
    });
    expect(r.mensagem).toMatch(/fica fora do repasse/);
    expect(porta.lancados).toHaveLength(0);
    const x = (await porta.realizado(ctx, id))!;
    expect(x.situacao).toBe('estornado');
    expect(x.estorno).toMatchObject({ por: 'SINT.COORD', motivo: 'Plantão registrado no dia errado' });
    expect((await servico.relatorio(sessao('SINT.COORD'), '2026-10')).grupos).toEqual([]);
    const l = await servico.lista(sessao('SINT.COORD'), { competencia: '2026-10', situacao: 'todos' });
    expect(l.itens.find((i) => i.plantao === ps[0])?.realizado?.situacao).toBe('estornado');
    // O estornado não se estorna de novo.
    expect(
      await codigo(
        servico.estornar(sessao('SINT.COORD'), { realizado: id, motivo: 'Segunda tentativa', versao: 2 }),
      ),
    ).toBe('nao-aprovado');
  });

  it('lançado com o repasse da competência já apurado: 409 que indica a devolução da apuração, nada gravado', async () => {
    const { porta, servico, ps, aprovado } = await montar();
    const id = await aprovado(ps[0], 99_500);
    porta.apuracoes.set('2026-10', { id: 31, estado: 'aprovada' });
    const e = await servico
      .estornar(sessao('SINT.COORD'), { realizado: id, motivo: 'Plantão não aconteceu', versao: 1 })
      .then(
        () => null,
        (x: unknown) => x as ErroProblema,
      );
    expect(e).toBeInstanceOf(ErroProblema);
    expect(e!.getStatus()).toBe(409);
    expect(e!.extras.codigo).toBe('repasse-apurado');
    expect(e!.detalhe).toMatch(/devolução da apuração/);
    expect(e!.extras.avisos).toEqual(['Devolução da apuração 31 em Repasse > Apuração do período']);
    expect((await porta.realizado(ctx, id))!.situacao).toBe('aprovado');
    expect(porta.lancados).toHaveLength(0);
    // A apuração ABERTA não barra (o estorno segue o caminho do lançamento negativo).
    porta.apuracoes.set('2026-10', { id: 31, estado: 'aberta' });
    expect(
      await codigo(
        servico.estornar(sessao('SINT.COORD'), { realizado: id, motivo: 'Plantão não aconteceu', versao: 1 }),
      ),
    ).toBe('ok');
  });

  it('lançado e não apurado: lançamento negativo na competência seguinte, apontando o original, ligado ao realizado', async () => {
    const { porta, servico, ps, aprovado } = await montar();
    const id = await aprovado(ps[0], 99_500);
    const r = await servico.estornar(sessao('SINT.COORD'), {
      realizado: id,
      motivo: 'Plantão não aconteceu',
      versao: 1,
    });
    expect(porta.lancados).toEqual([
      expect.objectContaining({
        origem: 'estorno',
        competencia: '2026-11',
        valor: -1200,
        estornaDe: 99_500,
        prestador: 77 + 9000,
        profissional: 77,
        evento: 40,
        plantoes: [],
      }),
    ]);
    const x = (await porta.realizado(ctx, id))!;
    expect(x.situacao).toBe('estornado');
    expect(x.estorno?.lancamento).toBeGreaterThan(0);
    expect(r.mensagem).toContain(`estorno do lançamento 99500`);
  });

  it('revisão W0-06: a ligação falha depois de a receita lançar: fica "estorno pendente", com alerta na trilha, e o novo pedido só liga o negativo já lançado', async () => {
    const { porta, servico, ps, aprovado, trilha } = await montar();
    const id = await aprovado(ps[0], 99_500);
    const original = porta.gravarSgh.bind(porta);
    let falhar = true;
    porta.gravarSgh = ((c, t, fn) =>
      original(c, t, (g) =>
        fn({
          ...g,
          ligarEstorno: async (x) => {
            if (falhar) {
              falhar = false;
              throw new Error('conexão perdida');
            }
            return g.ligarEstorno(x);
          },
        }),
      )) as typeof porta.gravarSgh;
    expect(
      await codigo(
        servico.estornar(sessao('SINT.COORD'), { realizado: id, motivo: 'Plantão não aconteceu', versao: 1 }),
      ),
    ).toBe('estorno-pendente');
    expect(porta.lancados).toHaveLength(1);
    const lancado = Number(porta.lancados[0]!['lancamento']);
    const x = (await porta.realizado(ctx, id))!;
    expect(x).toMatchObject({ situacao: 'estornado', lancamento: 99_500 });
    expect(x.estorno?.lancamento ?? null).toBeNull();
    expect(trilha.eventos.some((e) => e.resultado === 'falha' && e.idAlvo === String(id))).toBe(true);
    // A tela mostra o pendente e oferece concluir; registrar de novo não.
    const l = await servico.lista(sessao('SINT.COORD'), { competencia: '2026-10', situacao: 'todos' });
    const linha = l.itens.find((i) => i.plantao === ps[0])!;
    expect(linha.realizado?.estornoPendente).toBe(true);
    expect(linha.acoes).toMatchObject({ estornar: true, registrar: false });
    // Conciliação: liga o negativo já lançado; nada se lança de novo.
    const r = await servico.estornar(sessao('SINT.COORD'), {
      realizado: id,
      motivo: 'Concluir o estorno pendente',
      versao: x.versao,
    });
    expect(r.mensagem).toContain(`lançamento negativo ${lancado}`);
    expect(porta.lancados).toHaveLength(1);
    const y = (await porta.realizado(ctx, id))!;
    expect(y.estorno).toMatchObject({ lancamento: lancado, motivo: 'Plantão não aconteceu' });
    expect(
      await codigo(
        servico.estornar(sessao('SINT.COORD'), { realizado: id, motivo: 'De novo', versao: y.versao }),
      ),
    ).toBe('nao-aprovado');
  });

  it('revisão W0-06: estorno pendente sem o negativo lançado (a API caiu antes da receita): o novo pedido lança e liga', async () => {
    const { porta, servico, ps, aprovado } = await montar();
    const id = await aprovado(ps[0], 99_500);
    await porta.gravarSgh(
      ctx,
      () => ({}) as never,
      (g) => g.estornarRealizado({ id, versao: 1, motivo: 'Plantão não aconteceu', por: 'SINT.COORD' }),
    );
    expect(porta.lancados).toHaveLength(0);
    const x = (await porta.realizado(ctx, id))!;
    await servico.estornar(sessao('SINT.COORD'), { realizado: id, motivo: 'Concluir', versao: x.versao });
    expect(porta.lancados).toEqual([expect.objectContaining({ origem: 'estorno', estornaDe: 99_500 })]);
    expect((await porta.realizado(ctx, id))!.estorno?.lancamento).toBe(
      Number(porta.lancados[0]!['lancamento']),
    );
  });

  it('a receita recusa o lançamento negativo: o estorno volta para aprovado (nada fica pela metade)', async () => {
    const { porta, servico, ps, aprovado } = await montar();
    // O lançamento original que a receita não acha (outro realizado): original-inexistente.
    const id = await aprovado(ps[1], 99_600);
    Object.assign((await porta.realizado(ctx, id))!, { lancamento: 99_600 });
    const original = porta.executar.bind(porta);
    porta.executar = async () => {
      throw new ErroProblema('recusa-de-negocio', 409, 'Operação recusada', 'Original inexistente', {
        codigo: 'original-inexistente',
      });
    };
    expect(
      await codigo(
        servico.estornar(sessao('SINT.COORD'), { realizado: id, motivo: 'Plantão não aconteceu', versao: 1 }),
      ),
    ).toBe('original-inexistente');
    porta.executar = original;
    const x = (await porta.realizado(ctx, id))!;
    expect(x.situacao).toBe('aprovado');
    expect(x.estorno ?? null).toBeNull();
  });

  it('permissões: o não lançado pede aprovar; o lançado pede aprovar e lançar', async () => {
    const { servico, ps, aprovado } = await montar();
    const a = await aprovado(ps[0], null);
    const b = await aprovado(ps[1], 99_700);
    const soLer = sessao('SINT.LE', (c) => c === 'pessoas.realizado.ler');
    expect(
      await codigo(servico.estornar(soLer, { realizado: a, motivo: 'Plantão não aconteceu', versao: 1 })),
    ).toBe('sem-permissao');
    const soAprovar = sessao('SINT.APROVA', (c) => c !== 'pessoas.realizado.lancar');
    expect(
      await codigo(servico.estornar(soAprovar, { realizado: b, motivo: 'Plantão não aconteceu', versao: 1 })),
    ).toBe('sem-permissao');
  });
});
