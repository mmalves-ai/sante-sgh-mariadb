// W0-06 (programa CRUD completo): a desistência do ajuste de ponto pendente SÓ pelo próprio solicitante (outra pessoa:
// 403; decidido: 409; o desistido fica no histórico e não conta para lançar de novo) e a desativação e a reativação da
// regra do banco de horas com motivo (a desativada não entra no fechamento). Portas EM MEMÓRIA; dados SINTÉTICOS.
import { describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import type { ChaveLiberacao, PrerequisitoRecurso } from '../../config/configuracao-fonte.js';
import { fonteConfiguracaoMemoria } from '../../config/public-api.js';
import { CifraCpf } from '../cifra-cpf.js';
import { PortaEscalaMemoria } from '../escala/porta-escala-memoria.js';
import { PESSOAS_SINTETICAS_M52, PortaPessoasMemoria } from '../porta-memoria.js';
import { ServicoPessoas } from '../servico.js';
import { PortaPontoMemoria } from './porta-ponto-memoria.js';
import { ServicoPonto } from './servico-ponto.js';

/** Contexto da porta em memória pelo código do estabelecimento da sessão sintética. */
const ctxMem = (hospital: string) => ({
  cliente: 'memoria',
  estabelecimento: null,
  usuario: null,
  correlacao: 'teste',
  rede: 'rede-sintetica',
  hospital,
});

const C = PESSOAS_SINTETICAS_M52;
const chave = (c: string): ChaveLiberacao => ({
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
const cumprido = (recurso: string): PrerequisitoRecurso => ({
  recurso,
  tipo: 'aprovacao',
  situacao: 'cumprido',
  validade: null,
  evidencia: 'conferência sintética',
  alteradoPor: 'SINT.ADMIN',
  alteradoEm: '2026-10-25T10:00:00',
});
const cifra = new CifraCpf(Buffer.alloc(32, 7));

function montar(pontoLigado = true, comCifra = true) {
  const pessoas = new PortaPessoasMemoria();
  pessoas.hojeFixo = '2026-10-25';
  const trilha = new RegistradorTrilhaMemoria();
  const recursos = ['pessoas.colaborador', ...(pontoLigado ? ['pessoas.ponto'] : [])];
  const config = fonteConfiguracaoMemoria(trilha, {
    chavesIniciais: () => recursos.map(chave),
    prerequisitosIniciais: () => recursos.map(cumprido),
  });
  const rh = new ServicoPessoas(pessoas, trilha, config, null, cifra);
  const escala = new PortaEscalaMemoria(pessoas);
  const porta = new PortaPontoMemoria(pessoas);
  porta.agoraFixo = '2026-10-25T10:00';
  const servico = new ServicoPonto(porta, pessoas, escala, trilha, config, null, comCifra ? cifra : null);
  return { pessoas, porta, rh, escala, servico };
}

let k = 0;
function sessao(login = 'SINT.RH', hospital = 'pc'): SessaoCadastro {
  return {
    req: {
      headers: { 'idempotency-key': `w006-ponto-${++k}` },
      ip: '127.0.0.1',
      sgh: { sessao: { unidadeAtiva: null } },
    } as never,
    hospital,
    rede: 'rede-sintetica',
    login,
    porta: ctxMem(hospital),
    pode: () => true,
  };
}
async function admitir(rh: ServicoPessoas, admissao = '2026-01-01') {
  return (
    await rh.admitir(sessao(), {
      cpf: C.nova.cpf,
      nome: 'PESSOA NOVA SINTETICA',
      profissional: null,
      tipo: 'clt',
      admissao,
      cargo: 'Auxiliar administrativo',
      funcao: null,
      cargaSemanalHoras: 44,
      lotacao: { centroCusto: 9521, unidade: 1, setor: 'Posto 3' },
      matricula: null,
      usuario: null,
    })
  ).id;
}
async function codigo(p: Promise<unknown>): Promise<unknown> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ErroProblema);
  return (e as ErroProblema).extras['codigo'] ?? (e as ErroProblema).tipo;
}

const base = (v: number) => ({
  vinculo: v,
  dia: '2026-10-20',
  tipo: 'justificativa' as const,
  marcacao: null,
  instante: null,
  movimento: 7,
  justificativa: 1,
  periodo: null,
  minutos: 60,
  motivo: 'Consulta médica com atestado',
});

describe('desistência do ajuste pendente (W0-06)', () => {
  it('só o solicitante desiste, com motivo; o ajuste fica no histórico e pode ser lançado de novo', async () => {
    const d = montar();
    const v = await admitir(d.rh);
    const a = await d.servico.lancarAjuste(sessao('SINT.PEDE'), base(v));
    expect(
      await codigo(
        d.servico.desistirAjuste(sessao('SINT.OUTRO'), { ajuste: a.id!, motivo: 'Não sou eu quem pediu' }),
      ),
    ).toBe('nao-e-o-solicitante');
    await d.servico.desistirAjuste(sessao('SINT.PEDE'), { ajuste: a.id!, motivo: 'Lancei no dia errado' });
    const e = await d.servico.espelho(sessao('SINT.RH'), v, '2026-10');
    expect(e.ajustes.find((x) => x.id === a.id)).toMatchObject({
      situacao: 'desistido',
      decididoPor: 'SINT.PEDE',
      motivoDecisao: 'Lancei no dia errado',
    });
    expect(
      await codigo(
        d.servico.desistirAjuste(sessao('SINT.PEDE'), { ajuste: a.id!, motivo: 'De novo, por engano' }),
      ),
    ).toBe('ja-decidido');
    expect(
      await codigo(
        d.servico.decidirAjuste(sessao('SINT.APROVA'), { ajuste: a.id!, decisao: 'aprovar', motivo: null }),
      ),
    ).toBe('ja-decidido');
    // O desistido não barra lançar o certo no mesmo dia.
    await d.servico.lancarAjuste(sessao('SINT.PEDE'), base(v));
  });

  it('o aprovado não admite desistência; ajuste inexistente: 404', async () => {
    const d = montar();
    const v = await admitir(d.rh);
    const a = await d.servico.lancarAjuste(sessao('SINT.PEDE'), base(v));
    await d.servico.decidirAjuste(sessao('SINT.APROVA'), { ajuste: a.id!, decisao: 'aprovar', motivo: null });
    expect(
      await codigo(
        d.servico.desistirAjuste(sessao('SINT.PEDE'), { ajuste: a.id!, motivo: 'Mudei de ideia agora' }),
      ),
    ).toBe('ja-decidido');
    expect(
      await codigo(
        d.servico.desistirAjuste(sessao('SINT.PEDE'), { ajuste: 99999, motivo: 'Ajuste que não existe' }),
      ),
    ).toBe('nao-encontrado');
  });
});

describe('regra do banco de horas: desativação e reativação com motivo (W0-06)', () => {
  it('desativa e reativa pela versão; a desativada fica na lista com o motivo; repetir recusa', async () => {
    const d = montar();
    const regime = await d.escala.gravarSgh<number>(
      ctxMem('pc'),
      () => ({}) as never,
      (g) =>
        g.incluirRegime({
          codigo: '44H',
          nome: 'Comercial 44 h',
          jornada: 1,
          contratoParcial: 0,
          folgaPadrao: null,
          minutosPlantao: 480,
          descansoMinimoMin: 660,
          limiteSemanalHoras: 44,
          acordo: null,
          ativo: true,
          por: 'SINT.ESCALA',
        }),
    );
    await d.servico.gravarRegraBanco(sessao('SINT.ESCALA'), {
      regime,
      destino: 2,
      inicio: 1,
      desde: '2026-08',
      cicloMeses: 6,
      faltaDebita: false,
      versao: null,
    });
    await d.servico.situacaoRegraBanco(sessao('SINT.ESCALA'), {
      regime,
      versao: 0,
      ativo: false,
      motivo: 'Acordo coletivo do banco encerrado',
    });
    expect((await d.servico.regrasBanco(sessao())).itens[0]).toMatchObject({
      ativo: false,
      motivoSituacao: 'Acordo coletivo do banco encerrado',
      versao: 1,
    });
    expect(
      await codigo(
        d.servico.situacaoRegraBanco(sessao('SINT.ESCALA'), {
          regime,
          versao: 1,
          ativo: false,
          motivo: 'Desativar de novo por engano',
        }),
      ),
    ).toBe('regra-inativa');
    expect(
      await codigo(
        d.servico.situacaoRegraBanco(sessao('SINT.ESCALA'), {
          regime,
          versao: 0,
          ativo: true,
          motivo: 'Novo acordo coletivo assinado',
        }),
      ),
    ).toBe('desatualizado');
    await d.servico.situacaoRegraBanco(sessao('SINT.ESCALA'), {
      regime,
      versao: 1,
      ativo: true,
      motivo: 'Novo acordo coletivo assinado',
    });
    const lista = await d.servico.regrasBanco(sessao());
    expect(lista.itens[0]).toMatchObject({ ativo: true, versao: 2 });
    // Revisão W0-06: o motivo e o autor da desativação ficam no histórico depois da reativação.
    expect(lista.correcoes).toHaveLength(2);
    expect(lista.correcoes?.[0]).toMatchObject({
      operacao: 'banco.regra.reativada',
      regime,
      motivo: 'Novo acordo coletivo assinado',
      antes: {
        ativo: false,
        motivoSituacao: 'Acordo coletivo do banco encerrado',
        alteradoPor: 'SINT.ESCALA',
      },
      depois: { ativo: true, motivoSituacao: 'Novo acordo coletivo assinado' },
    });
    expect(lista.correcoes?.[1]).toMatchObject({
      operacao: 'banco.regra.desativada',
      motivo: 'Acordo coletivo do banco encerrado',
      antes: { ativo: true, motivoSituacao: null },
    });
  });
});
