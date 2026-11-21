// PROVA PONTA A PONTA do painel de onboarding (F4 L3) com a imagem SINTÉTICA do "cliente de exemplo" (dados 100%
// falsos, gerados pelo conector). Pelo serviço do painel (as rotas do controller, com a sessão do administrador da
// plataforma): criar o cliente -> listar a pasta autorizada -> vincular a imagem -> Importar -> acompanhar o progresso
// até o fim (o motor roda pelo conector.sh worker, como em produção) -> conferir no banco do cliente estabelecimento,
// usuários, pacientes e atendimentos contra o manifesto da imagem e a conciliação por contagem e soma de controle ->
// Sincronizar sem mudança (idempotente). O arquivo .fdb tem o mesmo sha256 antes e depois.
// Usa um banco plataforma de TESTE (plataforma_teste_onboarding) e o cliente exemplo_l3; apaga tudo no fim. Nunca toca
// no banco plataforma de uso nem em cópia real. SGH_NUCLEO_SEM_BANCO=1 pula.
// Rodar: vitest run --config apps/api/vitest.integracao.config.ts src/modulos/plataforma-onboarding/ponta-a-ponta.int.spec.ts
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ExecucaoConector } from '@sgh/contratos';
import { NucleoProprio, ambienteEfetivo } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { nucleoPlataforma } from '../../sessao/fonte-plataforma.js';
import { OnboardingController } from './onboarding.controller.js';
import { PonteConectorScript } from './ponte-script.js';
import { RepositorioOnboardingPlataforma } from './repositorio-plataforma.js';
import { ServicoOnboarding } from './servico.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const RAIZ = resolve(import.meta.dirname, '../../../../..');
const BANCO = 'plataforma_teste_onboarding';
const CLIENTE = 'exemplo_l3';
const ORIGENS = resolve(RAIZ, '.tmp/conector/origens-l3-e2e');
const ARQUIVO = 'exemplo-l3.fdb';
const FICHA = createHash('sha1').update(BANCO).digest('hex').slice(0, 6);
const ENV_CONECTOR = {
  ...process.env,
  CONECTOR_PLATAFORMA_BANCO: BANCO,
  CONECTOR_ORIGENS_DIR: ORIGENS,
  CONECTOR_SAIDA_DIR: ORIGENS,
  CONECTOR_RESERVA_GB: '1',
};

function sql(banco: string | null, texto: string): string {
  return execFileSync('sh', [resolve(RAIZ, 'tools/db/sql.sh'), ...(banco ? [banco] : []), '-N'], {
    input: texto,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}
const valor = (banco: string, q: string): number => Number(sql(banco, q).trim());
const sha256 = (arq: string): string => createHash('sha256').update(readFileSync(arq)).digest('hex');

function limpar(): void {
  sql(
    null,
    `DROP DATABASE IF EXISTS ${BANCO}; DROP DATABASE IF EXISTS cliente_${CLIENTE};
     DROP DATABASE IF EXISTS conector_ctl_${CLIENTE};`,
  );
  for (const l of sql(
    null,
    `SELECT CONCAT(user, '@', host) FROM mysql.user WHERE user LIKE 'sscon\\_%\\_${FICHA}'`,
  )
    .split('\n')
    .filter(Boolean)) {
    const [u, h] = l.split('@');
    sql(null, `DROP USER IF EXISTS '${u}'@'${h}';`);
  }
  rmSync(ORIGENS, { recursive: true, force: true });
}

/** Roda uma passada do motor (conector.sh worker --uma) e acompanha o progresso pelo serviço do painel. */
async function rodarMotor(c: OnboardingController, req: RequisicaoAutorizada, eid: number) {
  const vistos: { estado: string; percentual: number }[] = [];
  const motor = new Promise<void>((ok, falha) =>
    execFile(
      resolve(RAIZ, 'conector/conector.sh'),
      ['worker', '--uma'],
      { env: ENV_CONECTOR, timeout: 600_000, maxBuffer: 16 << 20 },
      (e) => (e ? falha(e) : ok()),
    ),
  );
  let fim = false;
  void motor.finally(() => (fim = true));
  while (!fim) {
    const x = await c.execucao(req, CLIENTE, String(eid));
    const u = vistos.at(-1);
    if (!u || u.estado !== x.estado || u.percentual !== x.percentual)
      vistos.push({ estado: x.estado, percentual: x.percentual });
    await new Promise((r) => setTimeout(r, 150));
  }
  await motor;
  const final: ExecucaoConector = await c.execucao(req, CLIENTE, String(eid));
  return { vistos, final };
}

describe.skipIf(SEM_BANCO)(
  'painel de onboarding ponta a ponta (imagem sintética do cliente de exemplo)',
  () => {
    let nucleo: NucleoProprio;
    let c: OnboardingController;
    let req: RequisicaoAutorizada;
    let manifesto: { contagens: Record<string, number>; esperado_destino: Record<string, number> };
    let shaAntes = '';

    beforeAll(async () => {
      limpar();
      sql(null, `CREATE DATABASE ${BANCO} CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci;`);
      for (const arq of readdirSync(resolve(RAIZ, 'db/plataforma'))
        .filter((a) => a.endsWith('.sql'))
        .sort())
        sql(BANCO, readFileSync(resolve(RAIZ, 'db/plataforma', arq), 'utf8'));
      sql(
        BANCO,
        `INSERT INTO administrador_plataforma (nome, email, ativo, criado_em)
       VALUES ('Administrador fictício', 'adm.onboarding@exemplo.invalid', TRUE, NOW(3));`,
      );
      const adm = valor(BANCO, 'SELECT MAX(id) FROM administrador_plataforma');
      req = { sgh: { sessao: { usuario: { id: `plataforma:${adm}`, ator: 'plataforma' } } } } as never;
      mkdirSync(ORIGENS, { recursive: true });
      execFileSync(resolve(RAIZ, 'conector/conector.sh'), ['sintetica', `/saida/${ARQUIVO}`, '--mapa'], {
        env: ENV_CONECTOR,
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      manifesto = JSON.parse(readFileSync(resolve(ORIGENS, 'exemplo-l3.manifesto.json'), 'utf8'));
      shaAntes = sha256(resolve(ORIGENS, ARQUIVO));
      nucleo = new NucleoProprio({ env: { ...ambienteEfetivo().env, SGH_BANCO_PLATAFORMA: BANCO } });
      const np = nucleoPlataforma(nucleo);
      if (!np) throw new Error('núcleo sem acesso ao banco plataforma');
      c = new OnboardingController(
        new ServicoOnboarding(
          new RepositorioOnboardingPlataforma(np),
          new PonteConectorScript({ raiz: RAIZ, plataforma: BANCO, env: { CONECTOR_ORIGENS_DIR: ORIGENS } }),
        ),
      );
    }, 300_000);

    afterAll(async () => {
      await nucleo?.encerrar();
      if (process.env['SGH_MANTER_EXEMPLO'] !== '1') limpar();
    });

    it('cria o cliente de exemplo pelo serviço do painel', async () => {
      const r = await c.criar(req, { codigo: CLIENTE, nome: 'Cliente de exemplo (teste do painel)' });
      expect(r.banco).toBe(`cliente_${CLIENTE}`);
      expect(r.tabelas).toBeGreaterThan(1000);
      expect(
        valor(
          BANCO,
          `SELECT COUNT(*) FROM cliente_evento WHERE tipo='criado' AND administrador_plataforma_id IS NOT NULL`,
        ),
      ).toBe(1);
      // catálogos OFICIAIS que a carga consulta e nunca cria (o carregador oficial do TISS 23 ainda não existe):
      // a prova semeia o caráter do atendimento e um município, como faria o carregador.
      sql(
        `cliente_${CLIENTE}`,
        `INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em)
         VALUES ('1', 'Eletiva', 'teste-tiss-23', UTC_TIMESTAMP(3)), ('2', 'Urgência/Emergência', 'teste-tiss-23', UTC_TIMESTAMP(3));
       SET FOREIGN_KEY_CHECKS = 0;
       INSERT INTO unidade_federativa (id, sigla, descricao, codigo_ibge, pais_referencia_id, criado_em)
         VALUES (35, 'SP', 'São Paulo', '35', 1, UTC_TIMESTAMP(3));
       INSERT INTO municipio_ibge (codigo_ibge, nome, unidade_federativa_id, versao_fonte, criado_em)
         VALUES ('3550308', 'São Paulo', 35, 'teste-ibge', UTC_TIMESTAMP(3));
       SET FOREIGN_KEY_CHECKS = 1;`,
      );
      expect(await problemaStatus(c.criar(req, { codigo: CLIENTE, nome: 'De novo' }))).toBe(409);
    }, 600_000);

    it('lista a pasta autorizada e vincula a imagem sintética', async () => {
      const { origens } = await c.origens(req);
      expect(origens.find((o) => o.arquivo === ARQUIVO)?.aceito).toBe(true);
      const v = await c.vincular(req, CLIENTE, { arquivo: ARQUIVO });
      expect(v.sha256).toBe(shaAntes);
      const { clientes } = await c.listar(req);
      expect(clientes.find((x) => x.codigo === CLIENTE)?.origem?.arquivo).toBe(ARQUIVO);
    }, 300_000);

    it('Importar: progresso até concluir, conciliação 100% e o banco do cliente conferido', async () => {
      const { execucao } = await c.pedir(req, CLIENTE, { tipo: 'importar' });
      expect(await problemaStatus(c.pedir(req, CLIENTE, { tipo: 'importar' }))).toBe(409);
      const { vistos, final } = await rodarMotor(c, req, execucao);
      expect(final.motivoFalha).toBe(null);
      expect(final.estado).toBe('concluida');
      expect(final.percentual).toBe(100);
      expect(final.arquivoInalterado).toBe(true);
      expect(vistos.length).toBeGreaterThan(2);
      expect(vistos.map((v) => v.percentual)).toEqual(
        [...vistos.map((v) => v.percentual)].sort((a, b) => a - b),
      );
      const ent = Object.fromEntries(final.entidades.map((e) => [e.entidade, e]));
      for (const e of final.entidades) {
        expect(e.conferido, e.entidade).toBe(true);
        expect(e.registrosOrigem, e.entidade).toBe(e.registrosDestino + e.recusados);
      }
      const esp = manifesto.esperado_destino;
      expect(ent['estabelecimento']?.registrosDestino).toBe(esp['estabelecimento']);
      expect(ent['usuario']?.registrosDestino).toBe(esp['usuario']);
      expect(ent['paciente']?.registrosDestino).toBe(esp['paciente']);
      expect(ent['atendimento']?.registrosDestino).toBe(esp['atendimento']);
      expect(ent['atendimento_ficha']?.registrosDestino).toBe(esp['ficha']);
      expect(ent['atendimento_alta']?.registrosDestino).toBe(esp['alta']);
      expect(ent['endereco_pessoa']?.registrosDestino).toBeGreaterThan(0);
      // no banco do cliente, independente da conciliação do motor
      const b = `cliente_${CLIENTE}`;
      for (const [tabela, chave] of [
        ['estabelecimento', 'estabelecimento'],
        ['usuario', 'usuario'],
        ['paciente', 'paciente'],
        ['atendimento', 'atendimento'],
      ] as const)
        expect(valor(b, `SELECT COUNT(*) FROM ${tabela} WHERE origem = 'migracao'`), tabela).toBe(esp[chave]);
      expect(
        valor(b, `SELECT COUNT(*) FROM pessoa_fisica pf JOIN paciente p ON p.pessoa_fisica_id = pf.id`),
      ).toBe(esp['paciente']);
      expect(valor(b, `SELECT COUNT(*) FROM usuario WHERE origem='migracao' AND exige_troca_senha`)).toBe(
        esp['usuario'],
      );
      expect(
        valor(b, `SELECT COUNT(*) FROM atendimento WHERE situacao='encerrado' AND desfecho IS NULL`),
      ).toBe(0);
      const ctl = `conector_ctl_${CLIENTE}`;
      expect(
        valor(ctl, `SELECT COUNT(*) FROM conciliacao WHERE execucao_id=${execucao} AND NOT conferido`),
      ).toBe(0);
      expect(valor(ctl, `SELECT COUNT(*) FROM conciliacao WHERE execucao_id=${execucao}`)).toBe(
        final.entidades.length + 1,
      );
      expect(final.pendencias.criticas).toBeGreaterThan(0);
      const regra = (r: string) =>
        final.pendencias.porRegra.filter((p) => p.regra === r).reduce((a, p) => a + p.quantidade, 0);
      expect(regra('prontuario_duplicado')).toBe(1);
      expect(regra('entrada_sentinela')).toBe(1); // recusada com pendência, sem derrubar a execução
      expect(regra('login_duplicado')).toBe(2); // 'JOÃO SILVA' = 'joao.silva' na collation do destino
      expect(regra('cnes_duplicado')).toBe(1);
      // tabelas do cliente de exemplo com linhas e fora do mapa: pendência tabela_sem_mapa (nunca ignoradas em silêncio)
      const foraDoMapa = Object.entries(manifesto.contagens).filter(([t, n]) => t.startsWith('EX_') && n > 0).length;
      expect(foraDoMapa).toBeGreaterThan(0);
      expect(regra('tabela_sem_mapa')).toBe(foraDoMapa);
      // toda linha recusada tem a regra gravada com ela e uma pendência desta execução
      expect(valor(ctl, `SELECT COUNT(*) FROM conector_origem WHERE id_destino IS NULL AND tabela_origem<>'TBTPEMP' AND regra_recusa IS NULL`)).toBe(0);
      expect(semPendencia(execucao)).toBe(0);
      expect(sha256(resolve(ORIGENS, ARQUIVO))).toBe(shaAntes);
    }, 900_000);

    it('Sincronizar: nada duplicado; alteração na origem e edição no destino viram pendência, sem falhar', async () => {
      const ctl = `conector_ctl_${CLIENTE}`;
      const b = `cliente_${CLIENTE}`;
      // simula a origem que seguiu operando: o hash guardado de um paciente e de uma alta deixa de bater
      sql(
        ctl,
        `UPDATE conector_origem SET hash_linha=UNHEX(REPEAT('00',16)) WHERE tabela_origem='RICADPAC'
           AND entidade_destino='paciente' AND id_destino IS NOT NULL ORDER BY id LIMIT 1;
         UPDATE conector_origem SET hash_linha=UNHEX(REPEAT('00',16)) WHERE tabela_origem='REALTA'
           AND id_destino IS NOT NULL ORDER BY id LIMIT 1;`,
      );
      // edição manual no sistema novo durante a avaliação (o próprio sistema marca versão e alteração)
      sql(
        b,
        `UPDATE usuario SET situacao='bloqueado', bloqueado_em=UTC_TIMESTAMP(), alterado_em=UTC_TIMESTAMP(3), versao=versao+1
           WHERE origem='migracao' AND situacao='ativo' ORDER BY id LIMIT 1;`,
      );
      const { execucao } = await c.pedir(req, CLIENTE, { tipo: 'sincronizar' });
      const { final } = await rodarMotor(c, req, execucao);
      expect(final.motivoFalha).toBe(null);
      expect(final.estado).toBe('concluida');
      expect(final.entidades.every((e) => e.conferido)).toBe(true);
      const regra = (r: string) =>
        final.pendencias.porRegra.filter((p) => p.regra === r).reduce((a, p) => a + p.quantidade, 0);
      expect(regra('alteracao_aguarda_sincronizar')).toBe(2);
      expect(regra('edicao_no_destino')).toBe(1);
      expect(regra('prontuario_duplicado')).toBe(1); // a recusa reaparece com a regra em toda execução
      expect(semPendencia(execucao)).toBe(0);
      // o hash guardado da linha alterada NÃO é sobrescrito: o Sincronizar do L9 ainda a detecta
      expect(
        valor(ctl, `SELECT COUNT(*) FROM conector_origem WHERE hash_linha=UNHEX(REPEAT('00',16)) AND tabela_origem IN ('RICADPAC','REALTA')`),
      ).toBe(2);
      expect(valor(b, `SELECT COUNT(*) FROM paciente WHERE origem = 'migracao'`)).toBe(
        manifesto.esperado_destino['paciente'],
      );
      expect(valor(b, `SELECT COUNT(*) FROM atendimento WHERE origem = 'migracao'`)).toBe(
        manifesto.esperado_destino['atendimento'],
      );
      const { clientes } = await c.listar(req);
      expect(clientes.find((x) => x.codigo === CLIENTE)?.ultimaExecucao?.tipo).toBe('sincronizar');
      expect(sha256(resolve(ORIGENS, ARQUIVO))).toBe(shaAntes);
    }, 900_000);
  },
);

/** Linhas recusadas (fora o de-para sem destino) sem pendência na execução `eid`: tem de ser 0. */
function semPendencia(eid: number): number {
  return valor(
    `conector_ctl_${CLIENTE}`,
    `SELECT COUNT(*) FROM conector_origem co WHERE co.id_destino IS NULL AND co.tabela_origem<>'TBTPEMP'
       AND NOT EXISTS (SELECT 1 FROM pendencia p WHERE p.execucao_id=${eid} AND p.tabela_origem=co.tabela_origem
                       AND p.chave_original=co.chave_original COLLATE utf8mb4_bin)`,
  );
}

async function problemaStatus(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 200;
  } catch (e) {
    return (e as { getStatus?: () => number }).getStatus?.() ?? 500;
  }
}
