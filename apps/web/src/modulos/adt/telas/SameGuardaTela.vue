<script setup lang="ts">
// Guarda do prontuário pelo volume (F3.9, 04-HOT L126): `/same/guarda`. Visão por paciente: busca pelo prontuário ou
// pela etiqueta do volume (o leitor manda a matrícula e o Enter); cada volume mostra onde está (local e posição no
// arquivo, ou o setor), a situação, o retorno atrasado e a linha do tempo. O formulário de movimento se monta pelo tipo
// e pelas exigências da operação do cadastro, e a regra do domínio confere na hora (o botão diz o que falta). A
// abertura do volume já o registra no local; o último movimento se desfaz com o motivo; o extravio fica registrado.
import { conferirMovimentoGuarda, type VolumeGuarda } from '@sgh/dominio-hotelaria';
import { SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  abrirVolume,
  buscarGuarda,
  desfazerUltimo,
  incluirLocal,
  lerApoioGuarda,
  lerOperacoesGuarda,
  lerVolumes,
  movimentarVolume,
  registrarExtravio,
  type VolumeTela,
} from '../api-same-guarda.js';

const { t } = useI18n();
const k = (c: string) => t(`adt.sameGuarda.${c}`);
const cliente = useQueryClient();
const busca = reactive({ prontuario: '', etiqueta: '' });
const paciente = ref<number | null>(null);
const realce = ref<number | null>(null);
const erro = ref('');
const aviso = ref('');

const operacoes = useQuery({ queryKey: ['same', 'guarda', 'operacoes'], queryFn: lerOperacoesGuarda });
const apoio = useQuery({ queryKey: ['same', 'guarda', 'apoio'], queryFn: lerApoioGuarda });
const volumes = useQuery({
  queryKey: computed(() => ['same', 'guarda', 'volumes', paciente.value]),
  queryFn: () => lerVolumes(paciente.value!),
  enabled: computed(() => paciente.value !== null),
});

const escolha = { valor: '', rotulo: k('escolha') };
const opSetores = computed(() => [
  escolha,
  ...(apoio.data.value?.setores ?? []).map((s) => ({ valor: String(s.id), rotulo: s.nome })),
]);
const opLocais = computed(() => [
  escolha,
  ...(apoio.data.value?.locais ?? []).map((l) => ({
    valor: String(l.id),
    rotulo:
      l.capacidade === null
        ? l.caminho
        : `${l.caminho} (${t('adt.sameGuarda.ocupacao', { volumes: l.volumes, capacidade: l.capacidade })})`,
  })),
]);
const opTipos = computed(() => [
  escolha,
  ...(apoio.data.value?.tiposDocumento ?? []).map((d) => ({ valor: String(d.id), rotulo: d.descricao })),
]);
const opOperacoes = computed(() => [
  escolha,
  ...(operacoes.data.value ?? [])
    .filter((o) => o.tipo !== 'registro')
    .map((o) => ({ valor: o.codigo, rotulo: o.descricao })),
]);

async function tentar(fn: () => Promise<unknown>, depois?: () => void): Promise<void> {
  erro.value = '';
  aviso.value = '';
  try {
    await fn();
    aviso.value = k('feito');
    depois?.();
    await cliente.invalidateQueries({ queryKey: ['same', 'guarda'] });
  } catch (e) {
    erro.value = (e as Error).message;
  }
}

async function buscar(): Promise<void> {
  erro.value = '';
  try {
    const r = await buscarGuarda(
      busca.etiqueta.trim() ? { etiqueta: busca.etiqueta.trim() } : { prontuario: busca.prontuario.trim() },
    );
    paciente.value = r.paciente;
    realce.value = r.volume;
    busca.etiqueta = '';
  } catch (e) {
    erro.value = (e as Error).message;
  }
}

// Abertura do volume (já guardado no local escolhido).
const novo = reactive({ tipoDocumento: '', local: '', linha: '', coluna: '', setor: '' });
const abrir = () =>
  tentar(
    () =>
      abrirVolume({
        paciente: paciente.value,
        tipoDocumento: Number(novo.tipoDocumento),
        localArquivo: Number(novo.local),
        posicaoLinha: novo.linha || null,
        posicaoColuna: novo.coluna || null,
        setor: novo.setor ? Number(novo.setor) : null,
      }),
    () => Object.assign(novo, { linha: '', coluna: '' }),
  );

// Local novo na árvore do arquivo.
const local = reactive({ nivel: 'sala', codigo: '', descricao: '', pai: '', capacidade: '' });
const NIVEIS = ['arquivo', 'sala', 'armario', 'estante', 'prateleira', 'gaveta', 'caixa'];
const salvarLocal = () =>
  tentar(
    () =>
      incluirLocal({
        nivel: local.nivel,
        codigo: local.codigo,
        descricao: local.descricao,
        pai: local.pai ? Number(local.pai) : null,
        capacidade: local.capacidade ? Number(local.capacidade) : null,
      }),
    () => Object.assign(local, { codigo: '', descricao: '' }),
  );

// Movimento de um volume: o formulário pelo tipo e pelas exigências da operação.
const mov = reactive<Record<number, Record<string, string>>>({});
const doVolume = (v: VolumeTela) =>
  (mov[v.id] ??= {
    operacao: '',
    setorDestino: '',
    localDestino: '',
    previsao: '',
    responsavel: '',
    aval: '',
    observacao: '',
    motivo: '',
  });
const operacaoDe = (v: VolumeTela) =>
  operacoes.data.value?.find((o) => o.codigo === doVolume(v).operacao) ?? null;
function estado(v: VolumeTela): VolumeGuarda {
  const u = v.movimentos.find((m) => !m.excluido) ?? null;
  return {
    situacao: v.situacao as VolumeGuarda['situacao'],
    noLocal: v.noLocal,
    localArquivo: v.local?.id ?? null,
    setorAtual: v.noLocal ? null : -1,
    temMovimento: !!u,
    ultimoTipo: (u?.operacao.tipo ?? null) as VolumeGuarda['ultimoTipo'],
  };
}
function problemas(v: VolumeTela): string[] {
  const o = operacaoDe(v);
  if (!o) return [];
  const f = doVolume(v);
  return conferirMovimentoGuarda(estado(v), {
    operacao: o,
    setorDestino: f['setorDestino'] ? Number(f['setorDestino']) : null,
    localDestino: f['localDestino'] ? Number(f['localDestino']) : null,
    previsaoRetorno: f['previsao'] ? new Date(`${f['previsao']}T23:59:00`) : null,
    avalComissao: f['aval'] || null,
    responsavel: f['responsavel'] || null,
    agora: new Date(),
  })
    .filter((p) => !(p.campo === 'setorDestino' && o.tipo === 'recebimento'))
    .map((p) => p.mensagem);
}
const pedeLocal = (v: VolumeTela) => {
  const o = operacaoDe(v);
  return !!o && (o.sentido === 'entrada' || (o.tipo === 'transferencia' && v.noLocal));
};
const pedeSetor = (v: VolumeTela) => {
  const o = operacaoDe(v);
  return (
    !!o &&
    (o.sentido === 'saida' || o.tipo === 'recebimento' || (o.tipo === 'transferencia' && !v.noLocal)) &&
    !o.encerraGuarda
  );
};
const movimentar = (v: VolumeTela) => {
  const f = doVolume(v);
  return tentar(
    () =>
      movimentarVolume(v.id, {
        operacao: f['operacao'],
        setorDestino: f['setorDestino'] ? Number(f['setorDestino']) : null,
        localDestino: f['localDestino'] ? Number(f['localDestino']) : null,
        previsaoRetorno: f['previsao'] || null,
        responsavel: f['responsavel'] || null,
        avalComissao: f['aval'] || null,
        observacao: f['observacao'] || null,
        versao: v.versao,
      }),
    () => delete mov[v.id],
  );
};
const desfazer = (v: VolumeTela) =>
  tentar(
    () => desfazerUltimo(v.id, { motivo: doVolume(v)['motivo'], versao: v.versao }),
    () => delete mov[v.id],
  );
const extraviar = (v: VolumeTela) =>
  tentar(
    () => registrarExtravio(v.id, { motivo: doVolume(v)['motivo'], versao: v.versao }),
    () => delete mov[v.id],
  );
const quando = (s: string | null) => (s ? new Date(s).toLocaleString('pt-BR') : '');
</script>

<template>
  <section class="same-guarda" data-testid="same-guarda">
    <h1>{{ k('titulo') }}</h1>
    <p>{{ k('texto') }}</p>
    <form class="linha" @submit.prevent="buscar">
      <SanteCampoTexto v-model="busca.prontuario" :rotulo="k('prontuario')" data-testid="guarda-prontuario" />
      <SanteCampoTexto v-model="busca.etiqueta" :rotulo="k('etiqueta')" data-testid="guarda-etiqueta" />
      <SanteBotao tipo="submit" :rotulo="k('buscar')" data-testid="guarda-buscar" />
    </form>
    <p v-if="erro" role="alert" class="erro" data-testid="guarda-erro">{{ erro }}</p>
    <p v-if="aviso" role="status" data-testid="guarda-aviso">{{ aviso }}</p>

    <template v-if="paciente !== null">
      <p v-if="volumes.data.value?.length === 0" data-testid="guarda-nenhum">{{ k('nenhum') }}</p>
      <article
        v-for="v in volumes.data.value ?? []"
        :key="v.id"
        class="volume"
        :class="{ realce: realce === v.id }"
        :data-testid="`guarda-volume-${v.numero}`"
      >
        <header>
          <strong>{{ v.tipoDocumento.descricao }} · {{ k('volume') }} {{ v.numero }}</strong>
          <span v-if="v.matricula"> · {{ v.matricula }}</span>
          <span class="situacao" data-testid="guarda-situacao"> · {{ v.situacao }}</span>
          <span v-if="v.retornoAtrasado" class="erro"> · {{ k('atrasado') }}</span>
        </header>
        <p>
          {{ k('ondeEsta') }}: <b data-testid="guarda-onde">{{ v.ondeEsta }}</b>
          <template v-if="v.posicao.linha || v.posicao.coluna">
            · {{ k('posicao') }} {{ v.posicao.linha }}/{{ v.posicao.coluna }}
          </template>
          <template v-if="v.previsaoRetorno"> · {{ k('previsao') }} {{ quando(v.previsaoRetorno) }}</template>
        </p>

        <div v-if="!['eliminado'].includes(v.situacao)" class="linha">
          <SanteSelecao
            v-model="doVolume(v).operacao"
            :rotulo="k('operacao')"
            :opcoes="opOperacoes"
            data-testid="guarda-operacao"
          />
          <SanteSelecao
            v-if="pedeSetor(v)"
            v-model="doVolume(v).setorDestino"
            :rotulo="k('setorDestino')"
            :opcoes="opSetores"
            data-testid="guarda-setor-destino"
          />
          <SanteSelecao
            v-if="pedeLocal(v)"
            v-model="doVolume(v).localDestino"
            :rotulo="k('localDestino')"
            :opcoes="opLocais"
            data-testid="guarda-local-destino"
          />
          <label v-if="operacaoDe(v)?.exigePrevisaoRetorno">
            {{ k('previsao') }}
            <input v-model="doVolume(v).previsao" type="date" data-testid="guarda-previsao" />
          </label>
          <SanteCampoTexto
            v-if="
              operacaoDe(v) && (operacaoDe(v)!.sentido === 'saida' || operacaoDe(v)!.tipo === 'recebimento')
            "
            v-model="doVolume(v).responsavel"
            :rotulo="k('responsavel')"
            data-testid="guarda-responsavel"
          />
          <SanteCampoTexto
            v-if="operacaoDe(v)?.encerraGuarda"
            v-model="doVolume(v).aval"
            :rotulo="k('aval')"
            data-testid="guarda-aval"
          />
          <SanteCampoTexto v-model="doVolume(v).observacao" :rotulo="k('observacao')" />
          <SanteBotao
            :rotulo="k('movimentar')"
            :desabilitado="!operacaoDe(v) || problemas(v).length > 0"
            data-testid="guarda-movimentar"
            @click="movimentar(v)"
          />
        </div>
        <ul v-if="problemas(v).length" class="erro" data-testid="guarda-falta">
          <li v-for="p in problemas(v)" :key="p">{{ p }}</li>
        </ul>

        <div class="linha">
          <SanteCampoTexto v-model="doVolume(v).motivo" :rotulo="k('motivo')" data-testid="guarda-motivo" />
          <SanteBotao
            :rotulo="k('desfazer')"
            :desabilitado="doVolume(v).motivo!.trim().length < 10"
            data-testid="guarda-desfazer"
            @click="desfazer(v)"
          />
          <SanteBotao
            :rotulo="k('extravio')"
            :desabilitado="doVolume(v).motivo!.trim().length < 10"
            data-testid="guarda-extravio"
            @click="extraviar(v)"
          />
        </div>

        <details>
          <summary>{{ k('linhaDoTempo') }}</summary>
          <ol>
            <li v-for="m in v.movimentos" :key="m.id" :class="{ desfeito: m.excluido }">
              {{ quando(m.em) }} · {{ m.operacao.descricao }}
              <template v-if="m.setorDestino"> · {{ m.setorDestino }}</template>
              <template v-if="m.localDestino"> · {{ m.localDestino }}</template>
              <template v-if="m.responsavel"> · {{ m.responsavel }}</template>
              <template v-if="m.por"> · {{ m.por }}</template>
              <em v-if="m.excluido"> ({{ k('desfeito') }})</em>
            </li>
          </ol>
        </details>
      </article>

      <form class="linha volume" data-testid="guarda-abrir" @submit.prevent="abrir">
        <strong>{{ k('abrir') }}</strong>
        <SanteSelecao
          v-model="novo.tipoDocumento"
          :rotulo="k('tipoDocumento')"
          :opcoes="opTipos"
          data-testid="guarda-tipo"
        />
        <SanteSelecao
          v-model="novo.local"
          :rotulo="k('local')"
          :opcoes="opLocais"
          data-testid="guarda-local"
        />
        <SanteCampoTexto v-model="novo.linha" :rotulo="k('linha')" />
        <SanteCampoTexto v-model="novo.coluna" :rotulo="k('coluna')" />
        <SanteSelecao v-model="novo.setor" :rotulo="k('setor')" :opcoes="opSetores" />
        <SanteBotao
          tipo="submit"
          :rotulo="k('abrir')"
          :desabilitado="!novo.tipoDocumento || !novo.local"
          data-testid="guarda-abrir-botao"
        />
      </form>
    </template>

    <details class="volume">
      <summary>{{ k('novoLocal') }}</summary>
      <form class="linha" data-testid="guarda-local-form" @submit.prevent="salvarLocal">
        <SanteSelecao
          v-model="local.nivel"
          :rotulo="k('nivel')"
          :opcoes="NIVEIS.map((n) => ({ valor: n, rotulo: n }))"
        />
        <SanteCampoTexto v-model="local.codigo" :rotulo="k('codigo')" data-testid="guarda-local-codigo" />
        <SanteCampoTexto
          v-model="local.descricao"
          :rotulo="k('descricao')"
          data-testid="guarda-local-descricao"
        />
        <SanteSelecao v-model="local.pai" :rotulo="k('pai')" :opcoes="opLocais" />
        <SanteCampoTexto v-model="local.capacidade" :rotulo="k('capacidade')" />
        <SanteBotao
          tipo="submit"
          :rotulo="k('incluirLocal')"
          :desabilitado="!local.codigo || !local.descricao"
          data-testid="guarda-local-incluir"
        />
      </form>
    </details>
  </section>
</template>

<style scoped>
.same-guarda {
  display: grid;
  gap: 1rem;
}
.linha {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: end;
}
.volume {
  border: 1px solid var(--sante-borda, #ccc);
  border-radius: 0.5rem;
  padding: 0.75rem;
}
.realce {
  outline: 2px solid var(--sante-primaria, #2563eb);
}
.erro {
  color: var(--sante-erro, #b91c1c);
}
.desfeito {
  text-decoration: line-through;
}
</style>
