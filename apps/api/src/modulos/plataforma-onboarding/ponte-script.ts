// PonteConector pelos comandos do repositório (desenvolvimento e homologação nesta VM): o serviço de criação de
// cliente (tools/db/criar_cliente.py, --json) e o conector (conector/conector.sh listar | vincular). O arquivo de
// origem só é aberto pelo conector, no container dele (regra 3); a API recebe só o resumo em JSON. Nenhum segredo vai
// na linha de comando: o conector.sh lê a senha do MariaDB do .env, e a variável herdada não é registrada.
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import type { ClienteCriado, OrigemDisponivel, OrigemVinculada, TesteOrigem } from '@sgh/contratos';
import { ErroOnboarding, type PonteConector } from './porta.js';
import type { PonteCarga } from './servico-carga.js';

export interface OpcoesPonteScript {
  /** Raiz do repositório (onde ficam tools/ e conector/). */
  readonly raiz: string;
  /** Banco plataforma (SGH_BANCO_PLATAFORMA; os testes usam um de teste). */
  readonly plataforma: string;
  /** Variáveis extras para o conector (CONECTOR_ORIGENS_DIR etc.). */
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly limiteMs?: number;
}

interface Saida {
  readonly codigo: number;
  readonly json: unknown;
}

const RECUSAS_409 = new Set(['cliente-existe', 'banco-existe']);

export class PonteConectorScript implements PonteConector, PonteCarga {
  constructor(private readonly o: OpcoesPonteScript) {}

  private rodar(cmd: string, args: readonly string[], limiteMs: number): Promise<Saida> {
    const env = {
      ...process.env,
      ...this.o.env,
      PLATAFORMA_BANCO: this.o.plataforma,
      CONECTOR_PLATAFORMA_BANCO: this.o.plataforma,
    };
    return new Promise((ok, falha) => {
      execFile(cmd, [...args], { env, timeout: limiteMs, maxBuffer: 8 << 20 }, (erro, stdout) => {
        const texto = String(stdout ?? '').trim();
        let json: unknown;
        try {
          const i = texto.search(/^[[{]/m);
          json = i >= 0 ? JSON.parse(texto.slice(i)) : null;
        } catch {
          json = null;
        }
        const codigo = erro ? Number((erro as { code?: unknown }).code ?? 1) || 1 : 0;
        if (erro && json === null)
          return falha(new ErroOnboarding('indisponivel', 'O serviço do conector não respondeu.'));
        ok({ codigo, json });
      });
    });
  }

  async criarCliente(
    codigo: string,
    nome: string,
    cnpj: string | null,
    admin: number | null,
  ): Promise<ClienteCriado> {
    const args = [
      '-I',
      resolve(this.o.raiz, 'tools/db/criar_cliente.py'),
      codigo,
      nome,
      '--origem',
      'conector_spdata',
    ];
    if (cnpj) args.push('--cnpj', cnpj);
    if (admin != null) args.push('--admin', String(admin));
    args.push('--plataforma', this.o.plataforma, '--json');
    const r = await this.rodar('python3', args, this.o.limiteMs ?? 600_000);
    const j = (r.json ?? {}) as Record<string, unknown>;
    if (r.codigo !== 0 || j['erro']) {
      const cod = String(j['codigo'] ?? '');
      throw new ErroOnboarding(
        RECUSAS_409.has(cod) ? 'conflito' : 'invalido',
        String(j['erro'] ?? 'Recusado.'),
      );
    }
    return { codigo: String(j['cliente']), banco: String(j['banco']), tabelas: Number(j['tabelas'] ?? 0) };
  }

  async listarOrigens(): Promise<OrigemDisponivel[]> {
    const r = await this.rodar(resolve(this.o.raiz, 'conector/conector.sh'), ['listar'], 120_000);
    if (r.codigo !== 0 || !Array.isArray(r.json))
      throw new ErroOnboarding('indisponivel', 'A pasta autorizada não pôde ser lida.');
    return (r.json as Record<string, unknown>[]).map((o) => ({
      arquivo: String(o['relativo']),
      tamanhoBytes: o['tamanho'] == null ? null : Number(o['tamanho']),
      aceito: o['aceito'] === true,
      motivo: o['motivo'] == null ? null : String(o['motivo']).slice(0, 200),
    }));
  }

  async vincular(codigo: string, arquivo: string, admin: number | null): Promise<OrigemVinculada> {
    const args = ['vincular', codigo, arquivo, ...(admin != null ? ['--admin', String(admin)] : [])];
    const r = await this.rodar(
      resolve(this.o.raiz, 'conector/conector.sh'),
      args,
      this.o.limiteMs ?? 1_800_000,
    );
    const j = (r.json ?? {}) as Record<string, unknown>;
    if (r.codigo !== 0 || j['erro'])
      throw new ErroOnboarding(
        Number(j['erro']) === 409 ? 'conflito' : 'invalido',
        String(j['motivo'] ?? 'Arquivo recusado.').slice(0, 300),
      );
    return {
      arquivo: String(j['arquivo']),
      tamanhoBytes: Number(j['tamanho_bytes']),
      sha256: String(j['sha256']),
    };
  }

  /** Tela de carga: `conector.sh testar-origem <cliente>` abre a conexão e a transação somente leitura no servidor de
   * origem e devolve só agregados (versão, ODS, número de tabelas). A senha fica no cofre: nunca na linha de comando. */
  async testarOrigem(codigo: string): Promise<TesteOrigem> {
    const r = await this.rodar(
      resolve(this.o.raiz, 'conector/conector.sh'),
      ['testar-origem', codigo],
      120_000,
    );
    const j = (r.json && typeof r.json === 'object' ? r.json : {}) as Record<string, unknown>;
    const texto = (v: unknown) => (v == null || v === '' ? null : String(v).slice(0, 80));
    // Quantidade em variável própria: o gerador de privilégios lê `tabelas: <nome>` como tabelas declaradas.
    const n = Number(j['tabelas']);
    const tabelas = Number.isSafeInteger(n) && n >= 0 ? n : null;
    const ok = r.codigo === 0 && j['ok'] === true;
    return {
      ok,
      versaoServidor: texto(j['versaoServidor'] ?? j['versao_servidor'] ?? j['versao']),
      ods: texto(j['ods']),
      tabelas,
      mensagem: String(
        j['mensagem'] ?? j['motivo'] ?? j['erro'] ?? (ok ? 'Conexão aberta.' : 'A conexão falhou.'),
      ).slice(0, 300),
    };
  }
}
