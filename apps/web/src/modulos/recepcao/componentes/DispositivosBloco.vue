<script setup lang="ts">
// Aparelhos do perfil Painel/Totem de um tipo (M19; ficha, seção 7, regras 9 e 10): a lista com validade, último uso
// e começo do token; cadastrar, renovar e revogar (recepcao.dispositivo.editar). O token aparece uma vez, com o
// endereço a abrir no aparelho (o token vai no fragmento #token=, que não chega ao servidor nem aos registros).
import type { DispositivoCriado, DispositivoLido, TipoDispositivo } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import {
  alterarDispositivo,
  conferirDispositivo,
  criarDispositivo,
  lerApoio,
  listarDispositivos,
  listarPaineisTv,
  listarUsuariosTecnicos,
  novaChave,
  renovarDispositivo,
  revogarDispositivo,
} from '../api-recepcao.js';
import { dataHoraDe } from '../formato.js';

const props = defineProps<{ tipo: TipoDispositivo; titulo: string }>();
const { t } = useI18n();
const cliente = useQueryClient();
const podeEditar = computed(() => pode('recepcao.dispositivo.editar'));
const lista = useQuery({ queryKey: ['recepcao', 'dispositivos'], queryFn: () => listarDispositivos() });
const apoio = useQuery({ queryKey: ['recepcao', 'apoio'], queryFn: () => lerApoio(), staleTime: 60_000 });
const tecnicos = useQuery({
  queryKey: ['recepcao', 'usuarios-tecnicos'],
  queryFn: () => listarUsuariosTecnicos(),
  // M43: os logins do grupo de painéis também são os que a TV ou o totem substituído usava (conferir no setor).
  enabled: computed(() => props.tipo !== 'paineltv' && podeEditar.value),
});
const portais = useQuery({
  queryKey: ['recepcao', 'paineis-tv'],
  queryFn: () => listarPaineisTv(),
  enabled: computed(() => props.tipo === 'paineltv'),
});
const doTipo = computed(() => (lista.data.value ?? []).filter((d) => d.tipo === props.tipo));
const nomeRecepcao = (id: number | null) =>
  id === null ? '—' : (apoio.data.value?.recepcoes.find((r) => r.id === id)?.descricao ?? String(id));

const criando = ref(false);
const nome = ref('');
const recepcao = ref('');
const locais = ref<number[]>([]);
const geradores = ref<number[]>([]);
const conteudo = ref('leitos');
const portal = ref('');
const usuario = ref('');
const validade = ref('365');
const voz = ref(true);
const criado = ref<DispositivoCriado | null>(null);
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const rec = computed(() => apoio.data.value?.recepcoes.find((r) => String(r.id) === recepcao.value) ?? null);
const opcoesRecepcao = computed(() =>
  (apoio.data.value?.recepcoes ?? []).map((r) => ({ valor: String(r.id), rotulo: r.descricao })),
);
const opcoesTecnico = computed(() => (tecnicos.data.value ?? []).map((u) => ({ valor: u, rotulo: u })));
const opcoesConteudo = computed(() =>
  (['leitos', 'higienizacao', 'bloco', 'pa'] as const).map((c) => ({
    valor: c,
    rotulo: t(`recepcao.dispositivos.conteudos.${c}`),
  })),
);
const opcoesPortal = computed(() => [
  { valor: '', rotulo: '—' },
  ...(portais.data.value ?? []).map((p) => ({ valor: String(p.ordem), rotulo: p.nome })),
]);
const validadeNum = computed(() => {
  const n = Number(validade.value);
  return Number.isInteger(n) && n >= 1 && n <= 730 ? n : 0;
});
// W1-04 (parte 5): alterar nome, conteúdo, locais, serviços e recepção do aparelho sem reemitir o token.
const editandoId = ref<number | null>(null);
const valido = computed(
  () =>
    nome.value.trim().length >= 3 &&
    (editandoId.value !== null || validadeNum.value > 0) &&
    (props.tipo === 'paineltv' || !!recepcao.value) &&
    (props.tipo !== 'totem' ||
      ((editandoId.value !== null || !!usuario.value) && geradores.value.length > 0)),
);
const dialogo = computed({
  get: () => criando.value,
  set: (v: boolean) => (criando.value = v),
});
const tokenAberto = computed({
  get: () => criado.value !== null,
  set: (v: boolean) => {
    if (!v) criado.value = null;
  },
});
function novo(): void {
  editandoId.value = null;
  nome.value = '';
  recepcao.value = opcoesRecepcao.value[0]?.valor ?? '';
  locais.value = [];
  geradores.value = [];
  usuario.value = opcoesTecnico.value[0]?.valor ?? '';
  validade.value = '365';
  voz.value = props.tipo === 'painel';
  criando.value = true;
}
function abrirAlterar(d: DispositivoLido): void {
  editandoId.value = d.id;
  nome.value = d.nome;
  recepcao.value = d.recepcao === null ? '' : String(d.recepcao);
  locais.value = [...d.locais];
  geradores.value = [...d.geradores];
  conteudo.value = d.conteudo ?? 'leitos';
  voz.value = d.voz;
  criando.value = true;
}
// O apoio (recepções) e os usuários técnicos podem chegar depois de o diálogo abrir: o padrão entra quando chegam.
watch([opcoesRecepcao, opcoesTecnico, criando], () => {
  if (!criando.value) return;
  if (!recepcao.value) recepcao.value = opcoesRecepcao.value[0]?.valor ?? '';
  if (!usuario.value) usuario.value = opcoesTecnico.value[0]?.valor ?? '';
});
async function executar(fn: () => Promise<unknown>): Promise<void> {
  mensagem.value = null;
  erro.value = null;
  try {
    await fn();
  } catch (e) {
    erro.value = e;
  } finally {
    await cliente.invalidateQueries({ queryKey: ['recepcao', 'dispositivos'] });
  }
}
const gravar = () => {
  criando.value = false;
  const id = editandoId.value;
  if (id !== null)
    return executar(async () => {
      await alterarDispositivo(
        id,
        {
          nome: nome.value,
          recepcao: props.tipo === 'paineltv' ? null : Number(recepcao.value),
          locais: props.tipo === 'painel' ? locais.value : [],
          geradores: props.tipo === 'totem' ? geradores.value : [],
          conteudo: props.tipo === 'paineltv' ? conteudo.value : null,
          voz: props.tipo === 'painel' && voz.value,
        },
        novaChave('alterar-dispositivo'),
      );
      mensagem.value = t('recepcao.dispositivos.alterado');
    });
  return executar(async () => {
    criado.value = await criarDispositivo(
      {
        tipo: props.tipo,
        nome: nome.value,
        recepcao: props.tipo === 'paineltv' ? null : Number(recepcao.value),
        locais: props.tipo === 'painel' ? locais.value : [],
        geradores: props.tipo === 'totem' ? geradores.value : [],
        conteudo: props.tipo === 'paineltv' ? conteudo.value : null,
        portalOrdem: props.tipo === 'paineltv' && portal.value !== '' ? Number(portal.value) : null,
        usuarioLegado: props.tipo === 'totem' ? usuario.value : null,
        validadeDias: validadeNum.value,
        voz: props.tipo === 'painel' && voz.value,
      },
      novaChave('dispositivo'),
    );
  });
};
const renovar = (id: number) =>
  executar(async () => {
    criado.value = await renovarDispositivo(id, 365, novaChave('renovar'));
  });
const revogar = (id: number) =>
  executar(async () => {
    mensagem.value = (await revogarDispositivo(id, novaChave('revogar'))).mensagem;
  });
// M43 (regra 4; cap-08 §8.3): a TI confere no setor e registra o login de TV ou de totem que o aparelho substitui.
const conferindo = ref<{ id: number; nome: string } | null>(null);
const loginSubstituido = ref('');
const dialogoConferir = computed({
  get: () => conferindo.value !== null,
  set: (v: boolean) => {
    if (!v) conferindo.value = null;
  },
});
function abrirConferir(id: number, nomeAparelho: string): void {
  loginSubstituido.value = opcoesTecnico.value[0]?.valor ?? '';
  conferindo.value = { id, nome: nomeAparelho };
}
const conferir = () => {
  const alvo = conferindo.value;
  conferindo.value = null;
  if (!alvo) return Promise.resolve();
  return executar(async () => {
    await conferirDispositivo(alvo.id, loginSubstituido.value, novaChave('conferir'));
    mensagem.value = t('recepcao.dispositivos.conferido');
  });
};
const enderecoCompleto = computed(() =>
  criado.value
    ? `${globalThis.location?.origin ?? ''}${criado.value.endereco}#token=${criado.value.token}`
    : '',
);
</script>

<template>
  <section class="painel" :aria-label="titulo" :data-testid="`dispositivos-${tipo}`">
    <h2>{{ titulo }}</h2>
    <p class="secundario">{{ t('recepcao.dispositivos.texto') }}</p>
    <SanteBotao
      v-if="podeEditar"
      :rotulo="t('recepcao.dispositivos.novo')"
      :data-testid="`novo-${tipo}`"
      @acionar="novo"
    />
    <p v-if="mensagem" role="status">{{ mensagem }}</p>
    <MensagemErro v-if="erro" :erro="erro" />
    <MensagemErro v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('recepcao.carregando') }}</p>
    <p v-else-if="doTipo.length === 0">{{ t('recepcao.dispositivos.nenhum') }}</p>
    <ul v-else class="agendados">
      <li v-for="d in doTipo" :key="d.id" :data-testid="`dispositivo-${d.id}`">
        <strong>{{ d.nome }}</strong> · {{ nomeRecepcao(d.recepcao) }} ·
        <template v-if="d.revogadoEm">{{
          t('recepcao.dispositivos.revogado', { data: dataHoraDe(d.revogadoEm) })
        }}</template>
        <template v-else>{{
          t('recepcao.dispositivos.validoAte', { data: dataHoraDe(d.validoAte) })
        }}</template>
        ·
        {{
          d.ultimoUso
            ? t('recepcao.dispositivos.ultimoUso', { data: dataHoraDe(d.ultimoUso) })
            : t('recepcao.dispositivos.nunca')
        }}
        · {{ t('recepcao.dispositivos.prefixo', { prefixo: d.prefixo }) }}
        <template v-if="d.usuarioLegado"> · {{ d.usuarioLegado }}</template>
        <template v-if="d.loginSubstituido && d.conferidoEm">
          ·
          <span :data-testid="`substitui-${d.id}`">{{
            t('recepcao.dispositivos.substitui', {
              login: d.loginSubstituido,
              data: dataHoraDe(d.conferidoEm),
            })
          }}</span>
        </template>
        <span v-if="podeEditar && !d.revogadoEm" class="acoes-linha">
          <SanteBotao
            v-if="tipo !== 'paineltv'"
            variante="texto"
            :rotulo="t('recepcao.dispositivos.conferir')"
            :data-testid="`conferir-${d.id}`"
            @acionar="abrirConferir(d.id, d.nome)"
          />
          <SanteBotao
            variante="texto"
            :rotulo="t('recepcao.dispositivos.alterar')"
            :data-testid="`alterar-${d.id}`"
            @acionar="abrirAlterar(d)"
          />
          <SanteBotao
            variante="texto"
            :rotulo="t('recepcao.dispositivos.renovar')"
            @acionar="renovar(d.id)"
          />
          <SanteBotao
            variante="destrutivo"
            :rotulo="t('recepcao.dispositivos.revogar')"
            :confirmacao="t('recepcao.dispositivos.revogarPergunta', { nome: d.nome })"
            @acionar="revogar(d.id)"
          />
        </span>
      </li>
    </ul>

    <SanteDialogo
      v-model:visivel="dialogo"
      :titulo="
        editandoId === null ? t('recepcao.dispositivos.novoTitulo') : t('recepcao.dispositivos.alterarTitulo')
      "
      largura="40rem"
    >
      <p v-if="editandoId !== null" class="secundario">{{ t('recepcao.dispositivos.alterarTexto') }}</p>
      <div class="formulario">
        <SanteCampoTexto
          v-model="nome"
          :rotulo="t('recepcao.dispositivos.nome')"
          :max-bytes="60"
          obrigatorio
          :data-testid="`nome-${tipo}`"
        />
        <SanteSelecao
          v-if="tipo !== 'paineltv'"
          v-model="recepcao"
          :rotulo="t('recepcao.recepcao')"
          :opcoes="opcoesRecepcao"
        />
        <SanteSelecao
          v-if="tipo === 'totem' && editandoId === null"
          v-model="usuario"
          :rotulo="t('recepcao.dispositivos.usuarioTecnico')"
          :opcoes="opcoesTecnico"
        />
        <fieldset v-if="tipo === 'totem' && rec">
          <legend>{{ t('recepcao.servicos') }}</legend>
          <label v-for="g in rec.geradores.filter((x) => x.ativo)" :key="g.id">
            <input v-model="geradores" type="checkbox" :value="g.id" /> {{ g.letra }} · {{ g.nome }}
          </label>
        </fieldset>
        <fieldset v-if="tipo === 'painel' && rec">
          <legend>{{ t('recepcao.dispositivos.locais') }}</legend>
          <label v-for="l in rec.locais.filter((x) => x.ativo)" :key="l.id">
            <input v-model="locais" type="checkbox" :value="l.id" /> {{ l.descricao }}
          </label>
        </fieldset>
        <label v-if="tipo === 'painel'"
          ><input v-model="voz" type="checkbox" /> {{ t('recepcao.dispositivos.voz') }}</label
        >
        <SanteSelecao
          v-if="tipo === 'paineltv'"
          v-model="conteudo"
          :rotulo="t('recepcao.dispositivos.conteudo')"
          :opcoes="opcoesConteudo"
        />
        <SanteSelecao
          v-if="tipo === 'paineltv' && editandoId === null"
          v-model="portal"
          :rotulo="t('recepcao.dispositivos.portal')"
          :opcoes="opcoesPortal"
        />
        <div v-if="editandoId === null" class="campo">
          <label :for="`validade-${tipo}`">{{ t('recepcao.dispositivos.validade') }}</label>
          <input :id="`validade-${tipo}`" v-model="validade" type="number" min="1" max="730" />
        </div>
      </div>
      <template #rodape>
        <SanteBotao variante="secundario" :rotulo="t('recepcao.cancelar')" @acionar="criando = false" />
        <SanteBotao
          :rotulo="t('recepcao.gravar')"
          :desabilitado="!valido"
          :data-testid="`gravar-${tipo}`"
          @acionar="gravar"
        />
      </template>
    </SanteDialogo>

    <SanteDialogo
      v-model:visivel="dialogoConferir"
      :titulo="t('recepcao.dispositivos.conferirTitulo')"
      largura="36rem"
    >
      <p>{{ t('recepcao.dispositivos.conferirTexto') }}</p>
      <p v-if="conferindo">
        <strong>{{ conferindo.nome }}</strong>
      </p>
      <SanteSelecao
        v-model="loginSubstituido"
        :rotulo="t('recepcao.dispositivos.loginSubstituido')"
        :opcoes="opcoesTecnico"
        busca
        data-testid="login-substituido"
      />
      <template #rodape>
        <SanteBotao variante="secundario" :rotulo="t('recepcao.cancelar')" @acionar="conferindo = null" />
        <SanteBotao
          :rotulo="t('recepcao.dispositivos.conferir')"
          :desabilitado="!loginSubstituido"
          data-testid="confirmar-conferir"
          @acionar="conferir"
        />
      </template>
    </SanteDialogo>

    <SanteDialogo v-model:visivel="tokenAberto" :titulo="t('recepcao.dispositivos.token')" largura="44rem">
      <SanteAlerta variante="aviso" :texto="t('recepcao.dispositivos.token')" />
      <p>{{ t('recepcao.dispositivos.endereco') }}</p>
      <p>
        <code data-testid="endereco-aparelho">{{ enderecoCompleto }}</code>
      </p>
      <template #rodape>
        <SanteBotao :rotulo="t('recepcao.fechar')" data-testid="fechar-token" @acionar="criado = null" />
      </template>
    </SanteDialogo>
  </section>
</template>
