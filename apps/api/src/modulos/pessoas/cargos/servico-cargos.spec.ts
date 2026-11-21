// W0-06, parte 4 (programa CRUD completo, M1 de mercado): cargos e salários pelo serviço da API. Cargo com CBO e
// conselho conferidos, alteração com motivo e o valor anterior no histórico; faixa salarial e vaga do quadro por versão
// a partir de uma data; inativação com motivo; exclusão só do nunca usado (o referenciado devolve 409 com a contagem e
// a oferta da inativação). Melhoria: tipos próprios da porta, sem o sistema de origem. Portas em memória (nada conecta a banco); dados sintéticos.
import type {
  ChaveLiberacao as ChaveGravada,
  PrerequisitoRecurso as PrerequisitoGravado,
} from '../../config/public-api.js';
import { describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import { fonteConfiguracaoMemoria } from '../../config/public-api.js';
import { PortaPessoasMemoria } from '../porta-memoria.js';
import { PortaCargosMemoria } from './porta-cargos-memoria.js';
import { PERMISSOES_CARGOS, ServicoCargos } from './servico-cargos.js';

const chave = (c: string, ligada = true): ChaveGravada => ({
  id: c,
  tipo: 'recurso',
  chave: c,
  escopo: 'hospital',
  valor: '*',
  ligada,
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
const CTX = {
  cliente: 'sintetico',
  estabelecimento: 1,
  usuario: 7,
  correlacao: 'teste-cargos',
  rede: 'rede-sintetica',
  hospital: 'pc',
};
let k = 0;
const sessao = (pode: (p: string) => boolean = () => true): SessaoCadastro => ({
  req: {
    headers: { 'idempotency-key': `w006-cargos-${++k}` },
    ip: '127.0.0.1',
    sgh: { sessao: { unidadeAtiva: null } },
  } as never,
  hospital: 'pc',
  rede: 'rede-sintetica',
  login: 'SINT.RH',
  porta: CTX,
  pode,
});

async function erro(p: Promise<unknown>): Promise<ErroProblema> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ErroProblema);
  return e as ErroProblema;
}
const codigo = async (p: Promise<unknown>) => (await erro(p)).extras['codigo'];

const MOTIVO = 'Lançado com o dado errado na implantação';

function montar(ligada = true) {
  const pessoas = new PortaPessoasMemoria();
  pessoas.hojeFixo = '2026-11-18';
  const porta = new PortaCargosMemoria();
  porta.agoraFixo = '2026-11-18T10:00';
  const trilha = new RegistradorTrilhaMemoria();
  const config = fonteConfiguracaoMemoria(trilha, {
    chavesIniciais: () => [chave('pessoas.colaborador', ligada)],
    prerequisitosIniciais: () => [cumprido('pessoas.colaborador')],
  });
  const svc = new ServicoCargos(porta, pessoas, trilha, config, null);
  return { svc, porta, trilha };
}

const ENFERMEIRO = {
  nome: 'Enfermeiro assistencial',
  cbo: '223505',
  descricao: 'Assistência de enfermagem ao paciente internado',
  requisitos: 'Graduação em enfermagem',
  conselho: 'COREN',
};

describe('W0-06 parte 4: cargos e salários (serviço)', () => {
  it('as permissões são as do arquivo do módulo (pessoas.cargos.*)', () => {
    expect(PERMISSOES_CARGOS).toEqual({ ler: 'pessoas.cargos.ler', gerir: 'pessoas.cargos.gerir' });
  });

  it('inclui o cargo com CBO e conselho conferidos; CBO ou conselho fora do cadastro recusa', async () => {
    const { svc } = montar();
    const s = sessao();
    const r = await svc.incluirCargo(s, ENFERMEIRO);
    const f = await svc.ficha(s, r.id);
    expect(f.cargo).toMatchObject({
      nome: 'Enfermeiro assistencial',
      cbo: '223505',
      conselho: 'COREN',
      ativo: true,
    });
    expect(f.cargo.cboDescricao).toBe('Enfermeiro');
    expect(await codigo(svc.incluirCargo(s, { ...ENFERMEIRO, cbo: '999999' }))).toBe('cbo-inexistente');
    expect(await codigo(svc.incluirCargo(s, { ...ENFERMEIRO, conselho: 'XYZ' }))).toBe(
      'conselho-inexistente',
    );
    const lista = await svc.lista(s);
    expect(lista.cargos.map((c) => c.id)).toEqual([r.id]);
  });

  it('a busca do CBO acha por código e por descrição (combo com busca)', async () => {
    const { svc } = montar();
    const s = sessao();
    expect((await svc.buscarCbo(s, '2235')).map((x) => x.codigo)).toContain('223505');
    expect((await svc.buscarCbo(s, 'técnico')).map((x) => x.codigo)).toContain('322205');
  });

  it('alteração do cargo com motivo: o valor anterior fica no histórico; versão velha recusa', async () => {
    const { svc } = montar();
    const s = sessao();
    const { id } = await svc.incluirCargo(s, ENFERMEIRO);
    const v0 = (await svc.ficha(s, id)).cargo.versao;
    await svc.alterarCargo(s, {
      ...ENFERMEIRO,
      nome: 'Enfermeiro da UTI',
      cargo: id,
      versao: v0,
      motivo: MOTIVO,
    });
    const f = await svc.ficha(s, id);
    expect(f.cargo.nome).toBe('Enfermeiro da UTI');
    expect(f.correcoes).toHaveLength(1);
    expect(f.correcoes[0]).toMatchObject({ motivo: MOTIVO, por: 'SINT.RH' });
    expect(JSON.stringify(f.correcoes[0]?.antes)).toContain('Enfermeiro assistencial');
    expect(
      await codigo(
        svc.alterarCargo(s, { ...ENFERMEIRO, nome: 'Outro', cargo: id, versao: v0, motivo: MOTIVO }),
      ),
    ).toBe('desatualizado');
  });

  it('faixa salarial: inclusão, versão nova a partir de uma data (a anterior acaba na véspera)', async () => {
    const { svc } = montar();
    const s = sessao();
    const { id: cargo } = await svc.incluirCargo(s, ENFERMEIRO);
    const { id: faixa } = await svc.incluirFaixa(s, {
      cargo,
      faixa: 'A',
      nivel: 'I',
      valor: 450_000,
      desde: '2026-01-01',
    });
    const f0 = (await svc.ficha(s, cargo)).faixas.find((x) => x.id === faixa);
    expect(f0).toMatchObject({ valor: 450_000, vigente: true, ate: null });
    expect(
      await codigo(
        svc.versaoFaixa(s, {
          faixa,
          versao: f0!.versao,
          valor: 450_000,
          desde: '2026-12-01',
          motivo: MOTIVO,
        }),
      ),
    ).toBe('nada-a-alterar');
    expect(
      await codigo(
        svc.versaoFaixa(s, {
          faixa,
          versao: f0!.versao,
          valor: 480_000,
          desde: '2025-12-01',
          motivo: MOTIVO,
        }),
      ),
    ).toBe('desde-antes');
    const { id: nova } = await svc.versaoFaixa(s, {
      faixa,
      versao: f0!.versao,
      valor: 480_000,
      desde: '2026-12-01',
      motivo: MOTIVO,
    });
    const fs = (await svc.ficha(s, cargo)).faixas;
    expect(fs.find((x) => x.id === faixa)).toMatchObject({ ate: '2026-11-30', vigente: false });
    expect(fs.find((x) => x.id === nova)).toMatchObject({ valor: 480_000, anterior: faixa, vigente: true });
    expect((await svc.lista(s)).cargos[0]?.faixasVigentes).toBe(1);
  });

  it('vaga do quadro por centro de custo: centro inativo recusa; duplicada recusa; versão nova da quantidade', async () => {
    const { svc } = montar();
    const s = sessao();
    const { id: cargo } = await svc.incluirCargo(s, ENFERMEIRO);
    expect(
      await codigo(svc.incluirVaga(s, { cargo, centroCusto: 9529, quantidade: 3, desde: '2026-01-01' })),
    ).toBe('centro-custo-inexistente');
    const { id: vaga } = await svc.incluirVaga(s, {
      cargo,
      centroCusto: 9521,
      quantidade: 3,
      desde: '2026-01-01',
    });
    expect(
      await codigo(svc.incluirVaga(s, { cargo, centroCusto: 9521, quantidade: 2, desde: '2026-02-01' })),
    ).toBe('vaga-vigente');
    const v0 = (await svc.ficha(s, cargo)).vagas.find((x) => x.id === vaga)!;
    expect(v0.centroCustoNome).toContain('Enfermagem');
    const { id: nova } = await svc.versaoVaga(s, {
      vaga,
      versao: v0.versao,
      quantidade: 5,
      desde: '2026-12-01',
      motivo: MOTIVO,
    });
    const f = await svc.ficha(s, cargo);
    expect(f.vagas.find((x) => x.id === nova)).toMatchObject({ quantidade: 5, vigente: true });
    expect(f.cargo.vagasAprovadas).toBe(5);
  });

  it('excluir cargo referenciado por colaborador ou vaga devolve 409 com a contagem e oferece inativar', async () => {
    const { svc, porta } = montar();
    const s = sessao();
    const { id: cargo } = await svc.incluirCargo(s, ENFERMEIRO);
    await svc.incluirVaga(s, { cargo, centroCusto: 9521, quantidade: 3, desde: '2026-01-01' });
    porta.ligarColaborador(CTX, { vinculo: 7001, cargo, centroCusto: 9521, desligado: false });
    const versao = (await svc.ficha(s, cargo)).cargo.versao;
    const e = await erro(svc.excluir(s, { alvo: 'cargo', id: cargo, versao, motivo: MOTIVO }));
    expect(e.getStatus()).toBe(409);
    expect(String(e.extras['codigo'])).toMatch(/-com-vinculos$/);
    expect(e.extras['bloqueios']?.length).toBeGreaterThanOrEqual(2);
    expect(e.detalhe).toMatch(/inative/);
    expect(porta.exclusoes(CTX.cliente)).toHaveLength(0);
    // A oferta: inativar com motivo (o histórico fica); a ocupação continua contada.
    await svc.situacao(s, { alvo: 'cargo', id: cargo, versao, ativo: false, motivo: MOTIVO });
    const f = await svc.ficha(s, cargo);
    expect(f.cargo).toMatchObject({ ativo: false, motivoSituacao: MOTIVO, ocupadas: 1 });
    expect(f.correcoes.map((c) => c.operacao)).toContain('cargo.inativado');
    // Cargo inativo não recebe faixa nem vaga nova.
    expect(
      await codigo(svc.incluirFaixa(s, { cargo, faixa: 'A', nivel: 'I', valor: 1000, desde: '2026-01-01' })),
    ).toBe('cargo-inativo');
  });

  it('excluir o nunca usado apaga e guarda o retrato da linha (D-CRUD-SNAP)', async () => {
    const { svc, porta } = montar();
    const s = sessao();
    const { id: cargo } = await svc.incluirCargo(s, ENFERMEIRO);
    const versao = (await svc.ficha(s, cargo)).cargo.versao;
    await svc.excluir(s, { alvo: 'cargo', id: cargo, versao, motivo: MOTIVO });
    expect((await svc.lista(s)).cargos).toHaveLength(0);
    expect(porta.exclusoes(CTX.cliente)).toMatchObject([{ id: cargo, motivo: MOTIVO, por: 'SINT.RH' }]);
    expect((await erro(svc.ficha(s, cargo))).getStatus()).toBe(404);
  });

  it('faixa com versão posterior não se exclui (é histórico): 409 e a inativação da vigente', async () => {
    const { svc } = montar();
    const s = sessao();
    const { id: cargo } = await svc.incluirCargo(s, ENFERMEIRO);
    const { id: faixa } = await svc.incluirFaixa(s, {
      cargo,
      faixa: 'A',
      nivel: 'I',
      valor: 1000,
      desde: '2026-01-01',
    });
    const v = (await svc.ficha(s, cargo)).faixas[0]!.versao;
    const { id: nova } = await svc.versaoFaixa(s, {
      faixa,
      versao: v,
      valor: 2000,
      desde: '2026-06-01',
      motivo: MOTIVO,
    });
    const antiga = (await svc.ficha(s, cargo)).faixas.find((x) => x.id === faixa)!;
    expect(
      (
        await erro(svc.excluir(s, { alvo: 'faixa', id: faixa, versao: antiga.versao, motivo: MOTIVO }))
      ).getStatus(),
    ).toBe(409);
    expect(
      await codigo(
        svc.situacao(s, { alvo: 'faixa', id: faixa, versao: antiga.versao, ativo: false, motivo: MOTIVO }),
      ),
    ).toBe('versao-encerrada');
    const vig = (await svc.ficha(s, cargo)).faixas.find((x) => x.id === nova)!;
    await svc.situacao(s, { alvo: 'faixa', id: nova, versao: vig.versao, ativo: false, motivo: MOTIVO });
    expect((await svc.ficha(s, cargo)).faixas.find((x) => x.id === nova)).toMatchObject({
      ativo: false,
      vigente: false,
    });
  });

  it('com a chave desligada a gravação recusa; o apoio diz o motivo e o perfil sem gerir não grava pela tela', async () => {
    const { svc } = montar(false);
    const s = sessao();
    const ap = await svc.apoioTela(s);
    expect(ap.gravacao.ligada).toBe(false);
    expect(ap.acoes.gerir).toBe(false);
    expect((await erro(svc.incluirCargo(s, ENFERMEIRO))).getStatus()).toBeGreaterThanOrEqual(400);
    const semGerir = await montar().svc.apoioTela(sessao((p) => p !== PERMISSOES_CARGOS.gerir));
    expect(semGerir.acoes).toMatchObject({ gerir: false, motivo: expect.stringMatching(/perfil/) });
  });

  it('a trilha registra os eventos de cargo, faixa salarial e vaga', async () => {
    const { svc, trilha } = montar();
    const s = sessao();
    const { id: cargo } = await svc.incluirCargo(s, ENFERMEIRO);
    await svc.incluirFaixa(s, { cargo, faixa: 'A', nivel: 'I', valor: 1000, desde: '2026-01-01' });
    await svc.incluirVaga(s, { cargo, centroCusto: 9521, quantidade: 1, desde: '2026-01-01' });
    const eventos = JSON.stringify(trilha);
    expect(eventos).toContain('pessoas.cargo.gravado');
    expect(eventos).toContain('pessoas.faixa_salarial.gravada');
    expect(eventos).toContain('pessoas.vaga.gravada');
  });
});
