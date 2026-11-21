<script setup lang="ts">
// Auditores designados da operadora (M56, etapa 5, F4; `operadora.auditor.designar`, da diretoria da operadora): a lista
// das designações (ativas primeiro), designar o médico ou o enfermeiro auditor com o conselho (CRM ou COREN), o número
// e a UF, e encerrar a designação com o motivo. Só quem está designado e vigente decide os pedidos daquela operadora; a
// diretoria não vê o conteúdo clínico das guias. W0-10: alterar os dados da designação (motivo e confirmação; a versão
// anterior fica no histórico) e trocar o auditor com pedidos em análise só com a redistribuição a outro auditor ativo
// da mesma operadora (sem ela, o servidor recusa com a contagem e os protocolos).
import { type AuditorOperadora, CATEGORIAS_AUDITOR, UFS } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { alterarAuditor, designarAuditor, encerrarAuditor, lerAuditores } from '../api-autorizacao.js';

const props = defineProps<{
  /** As operadoras do estabelecimento (a tela de onde a seção abre já as leu). */
  operadoras: readonly { id: number; nome: string; registroAns: string }[];
  hoje: string;
}>();
const { t } = useI18n();
const cliente = useQueryClient();
const lista = useQuery({
  queryKey: ['operadora', 'autorizacoes', 'auditores'],
  queryFn: () => lerAuditores(),
});
const mensagem = ref<string | null>(null);
const recusa = ref<string | null>(null);
const erro = ref<unknown>(null);

const nomeOperadora = (id: number) => props.operadoras.find((o) => o.id === id)?.nome ?? String(id);
const data = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');

const f = reactive({
  operadora: (props.operadoras[0]?.id ?? null) as number | null,
  login: '',
  nome: '',
  categoria: 'medico' as string | null,
  numero: '',
  uf: 'SC' as string | null,
  inicio: props.hoje as string | null,
});
const designando = ref(false);
const opcoesOperadora = computed(() =>
  props.operadoras.map((o) => ({ valor: o.id, rotulo: `${o.nome} · ANS ${o.registroAns}` })),
);
const opcoesCategoria = Object.entries(CATEGORIAS_AUDITOR).map(([valor, c]) => ({ valor, rotulo: c.rotulo }));
const opcoesUf = UFS.map((u) => ({ valor: u as string, rotulo: u }));
const completo = computed(
  () =>
    f.operadora !== null &&
    f.login.trim().length >= 2 &&
    f.nome.trim().length >= 3 &&
    f.categoria !== null &&
    /^\d{1,15}$/.test(f.numero.trim()) &&
    f.uf !== null &&
    f.inicio !== null,
);

function falhou(e: unknown): void {
  if (e instanceof ErroApi && e.problema?.detail && [400, 403, 404, 409].includes(e.status))
    recusa.value = e.problema.detail;
  else erro.value = e;
}
async function recarregar(): Promise<void> {
  await cliente.invalidateQueries({ queryKey: ['operadora', 'autorizacoes'] });
}
async function designar(): Promise<void> {
  if (!completo.value) return;
  recusa.value = null;
  erro.value = null;
  try {
    const r = await designarAuditor({
      operadora: f.operadora,
      login: f.login.trim(),
      nome: f.nome,
      categoria: f.categoria,
      numero: f.numero.trim(),
      uf: f.uf,
      inicio: f.inicio,
    });
    mensagem.value = r.mensagem;
    designando.value = false;
    await recarregar();
  } catch (e) {
    falhou(e);
  }
}

const encerrando = ref<AuditorOperadora | null>(null);
const motivo = ref('');
const redistribuirPara = ref<number | null>(null);
/** Os protocolos que o servidor devolveu na recusa (a lista pode ter mudado depois da leitura). */
const pedidosDoAuditor = ref<{ quantidade: number; amostra: string[] } | null>(null);
const confirmandoEncerrar = ref(false);
const dialogoEncerrar = computed({
  get: () => encerrando.value !== null,
  set: (v: boolean) => {
    if (!v) encerrando.value = null;
  },
});
const exigeRedistribuicao = computed(
  () => (encerrando.value?.emAnalise ?? 0) > 0 || (pedidosDoAuditor.value?.quantidade ?? 0) > 0,
);
const quantosEmAnalise = computed(
  () => pedidosDoAuditor.value?.quantidade ?? encerrando.value?.emAnalise ?? 0,
);
const opcoesRedistribuir = computed(() =>
  (lista.data.value?.itens ?? [])
    .filter(
      (x) =>
        x.situacao === 'ativo' &&
        x.id !== encerrando.value?.id &&
        x.operadora === encerrando.value?.operadora,
    )
    .map((x) => ({ valor: x.id, rotulo: `${x.nome} · ${x.conselho} ${x.numero}/${x.uf}` })),
);
const podeEncerrar = computed(
  () => motivo.value.trim().length >= 10 && (!exigeRedistribuicao.value || redistribuirPara.value !== null),
);
function abrirEncerrar(a: AuditorOperadora): void {
  encerrando.value = a;
  motivo.value = '';
  redistribuirPara.value = null;
  pedidosDoAuditor.value = null;
  confirmandoEncerrar.value = false;
  recusa.value = null;
  erro.value = null;
}
async function encerrar(): Promise<void> {
  const a = encerrando.value;
  if (!a || !podeEncerrar.value) return;
  recusa.value = null;
  erro.value = null;
  try {
    const r = await encerrarAuditor(a.id, {
      versao: a.versao,
      motivo: motivo.value,
      ...(redistribuirPara.value !== null ? { redistribuirPara: redistribuirPara.value } : {}),
    });
    mensagem.value = r.mensagem;
    encerrando.value = null;
    await recarregar();
  } catch (e) {
    confirmandoEncerrar.value = false;
    const p = e instanceof ErroApi ? e.problema : null;
    if (p?.codigo === 'auditor-com-autorizacoes') {
      const d = p.dependentes?.[0];
      pedidosDoAuditor.value = { quantidade: d?.quantidade ?? 0, amostra: [...(d?.amostra ?? [])] };
      await recarregar();
    }
    falhou(e);
  }
}

const alterando = ref<AuditorOperadora | null>(null);
const fa = reactive({
  categoria: 'medico' as string | null,
  numero: '',
  uf: 'SC' as string | null,
  motivo: '',
});
const confirmandoAlterar = ref(false);
const dialogoAlterar = computed({
  get: () => alterando.value !== null,
  set: (v: boolean) => {
    if (!v) alterando.value = null;
  },
});
const alteracaoCompleta = computed(
  () =>
    fa.categoria !== null &&
    /^\d{1,15}$/.test(fa.numero.trim()) &&
    fa.uf !== null &&
    fa.motivo.trim().length >= 10,
);
function abrirAlterar(a: AuditorOperadora): void {
  alterando.value = a;
  Object.assign(fa, { categoria: a.categoria, numero: a.numero, uf: a.uf, motivo: '' });
  confirmandoAlterar.value = false;
  recusa.value = null;
  erro.value = null;
}
async function alterar(): Promise<void> {
  const a = alterando.value;
  if (!a || !alteracaoCompleta.value) return;
  recusa.value = null;
  erro.value = null;
  try {
    const r = await alterarAuditor(a.id, {
      versao: a.versao,
      categoria: fa.categoria,
      numero: fa.numero.trim(),
      uf: fa.uf,
      motivo: fa.motivo,
    });
    mensagem.value = r.mensagem;
    alterando.value = null;
    await recarregar();
  } catch (e) {
    confirmandoAlterar.value = false;
    falhou(e);
  }
}
</script>

<template>
  <section class="bloco" aria-labelledby="ope-aut-auditores" data-testid="aut-auditores">
    <h2 id="ope-aut-auditores">{{ t('operadoraAutorizacao.auditores.titulo') }}</h2>
    <p class="secundario">{{ t('operadoraAutorizacao.auditores.texto') }}</p>
    <p v-if="mensagem" role="status" data-testid="aut-auditores-mensagem">{{ mensagem }}</p>
    <SanteAlerta
      v-if="recusa && !designando && !encerrando && !alterando"
      :texto="recusa"
      variante="alerta"
    />
    <MensagemErro v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('operadoraAutorizacao.carregando') }}</p>
    <p v-else-if="lista.data.value.itens.length === 0">{{ t('operadoraAutorizacao.auditores.nenhum') }}</p>
    <table v-else class="tabela" data-testid="aut-auditores-lista">
      <caption class="visualmente-oculto">
        {{
          t('operadoraAutorizacao.auditores.titulo')
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t('operadoraAutorizacao.auditores.nome') }}</th>
          <th scope="col">{{ t('operadoraAutorizacao.auditores.login') }}</th>
          <th scope="col">{{ t('operadoraAutorizacao.auditores.categoria') }}</th>
          <th scope="col">{{ t('operadoraAutorizacao.auditores.conselho') }}</th>
          <th scope="col">{{ t('operadoraAutorizacao.auditores.operadora') }}</th>
          <th scope="col">{{ t('operadoraAutorizacao.auditores.inicio') }}</th>
          <th scope="col">{{ t('operadoraAutorizacao.auditores.situacao') }}</th>
          <th scope="col">
            <span class="visualmente-oculto">{{ t('operadoraAutorizacao.colunas.acoes') }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="a in lista.data.value.itens" :key="a.id">
          <td>{{ a.nome }}</td>
          <td>{{ a.login }}</td>
          <td>{{ t(`operadoraAutorizacao.auditores.categorias.${a.categoria}`) }}</td>
          <td>{{ a.conselho }} {{ a.numero }}/{{ a.uf }}</td>
          <td>{{ nomeOperadora(a.operadora) }}</td>
          <td>{{ data(a.inicio) }}</td>
          <td>
            {{ t(`operadoraAutorizacao.auditores.situacoes.${a.situacao}`) }}
            <template v-if="a.fim"> · {{ data(a.fim) }}</template>
            <template v-if="a.emAnalise > 0">
              · {{ t('operadoraAutorizacao.auditores.emAnalise', { n: a.emAnalise }) }}</template
            >
          </td>
          <td>
            <SanteBotao
              v-if="a.situacao === 'ativo'"
              variante="texto"
              :rotulo="t('operadoraAutorizacao.auditores.alterar', { nome: a.nome })"
              :data-testid="`aut-alterar-${a.id}`"
              @acionar="abrirAlterar(a)"
            />
            <SanteBotao
              v-if="a.situacao === 'ativo'"
              variante="texto"
              :rotulo="t('operadoraAutorizacao.auditores.encerrar', { nome: a.nome })"
              :data-testid="`aut-encerrar-${a.id}`"
              @acionar="abrirEncerrar(a)"
            />
          </td>
        </tr>
      </tbody>
    </table>
    <div class="acoes">
      <SanteBotao
        variante="secundario"
        :rotulo="t('operadoraAutorizacao.auditores.designar')"
        data-testid="aut-designar"
        @acionar="
          designando = true;
          recusa = null;
        "
      />
    </div>

    <SanteDialogo
      v-model:visivel="designando"
      :titulo="t('operadoraAutorizacao.auditores.designar')"
      largura="44rem"
    >
      <form class="campos" data-testid="form-designar" @submit.prevent="designar">
        <SanteSelecao
          v-model="f.operadora"
          :rotulo="t('operadoraAutorizacao.auditores.operadora')"
          :opcoes="opcoesOperadora"
          :busca="true"
          obrigatorio
          data-testid="aut-des-operadora"
        />
        <SanteCampoTexto
          id="aut-des-login"
          v-model="f.login"
          :rotulo="t('operadoraAutorizacao.auditores.login')"
          :max-bytes="31"
          obrigatorio
        />
        <SanteCampoTexto
          id="aut-des-nome"
          v-model="f.nome"
          :rotulo="t('operadoraAutorizacao.auditores.nome')"
          :max-bytes="120"
          obrigatorio
        />
        <SanteSelecao
          v-model="f.categoria"
          :rotulo="t('operadoraAutorizacao.auditores.categoria')"
          :opcoes="opcoesCategoria"
          obrigatorio
          data-testid="aut-des-categoria"
        />
        <SanteCampoTexto
          id="aut-des-numero"
          v-model="f.numero"
          :rotulo="t('operadoraAutorizacao.auditores.numero')"
          :max-bytes="15"
          obrigatorio
        />
        <SanteSelecao
          v-model="f.uf"
          :rotulo="t('operadoraAutorizacao.auditores.uf')"
          :opcoes="opcoesUf"
          obrigatorio
          data-testid="aut-des-uf"
        />
        <SanteData v-model="f.inicio" :rotulo="t('operadoraAutorizacao.auditores.inicio')" editavel />
        <SanteAlerta v-if="recusa" :texto="recusa" variante="alerta" data-testid="aut-des-recusa" />
        <MensagemErro v-if="erro" :erro="erro" />
      </form>
      <template #rodape>
        <SanteBotao
          variante="secundario"
          :rotulo="t('operadoraAutorizacao.acoes.voltar')"
          @acionar="designando = false"
        />
        <SanteBotao
          :rotulo="t('operadoraAutorizacao.auditores.designar')"
          :desabilitado="!completo"
          data-testid="aut-des-gravar"
          @acionar="designar"
        />
      </template>
    </SanteDialogo>

    <SanteDialogo
      v-model:visivel="dialogoEncerrar"
      :titulo="t('operadoraAutorizacao.auditores.encerrar', { nome: encerrando?.nome ?? '' })"
      largura="40rem"
    >
      <div class="formulario">
        <SanteCampoTexto
          id="aut-enc-motivo"
          v-model="motivo"
          :rotulo="t('operadoraAutorizacao.auditores.motivo')"
          :max-bytes="200"
          multilinha
          obrigatorio
        />
        <template v-if="exigeRedistribuicao">
          <SanteAlerta
            :texto="t('operadoraAutorizacao.auditores.redistribuirTexto', { n: quantosEmAnalise })"
            variante="aviso"
            data-testid="aut-enc-pedidos"
          />
          <ul v-if="pedidosDoAuditor?.amostra.length" class="secundario" data-testid="aut-enc-protocolos">
            <li v-for="p in pedidosDoAuditor.amostra" :key="p">{{ p }}</li>
          </ul>
          <SanteSelecao
            v-model="redistribuirPara"
            :rotulo="t('operadoraAutorizacao.auditores.redistribuirPara')"
            :opcoes="opcoesRedistribuir"
            :busca="true"
            obrigatorio
            data-testid="aut-enc-redistribuir"
          />
          <p v-if="opcoesRedistribuir.length === 0" class="secundario">
            {{ t('operadoraAutorizacao.auditores.semOutroAuditor') }}
          </p>
        </template>
        <div
          v-if="confirmandoEncerrar"
          class="painel-confirmacao"
          role="group"
          data-testid="aut-enc-confirmacao"
        >
          <p>
            {{
              exigeRedistribuicao
                ? t('operadoraAutorizacao.auditores.confirmarEncerrarRedistribuir', {
                    nome: encerrando?.nome ?? '',
                    n: quantosEmAnalise,
                    para: opcoesRedistribuir.find((o) => o.valor === redistribuirPara)?.rotulo ?? '',
                  })
                : t('operadoraAutorizacao.auditores.confirmarEncerrar', { nome: encerrando?.nome ?? '' })
            }}
          </p>
        </div>
        <SanteAlerta v-if="recusa" :texto="recusa" variante="alerta" data-testid="aut-enc-recusa" />
        <MensagemErro v-if="erro" :erro="erro" />
      </div>
      <template #rodape>
        <SanteBotao
          variante="secundario"
          :rotulo="t('operadoraAutorizacao.acoes.voltar')"
          @acionar="confirmandoEncerrar ? (confirmandoEncerrar = false) : (encerrando = null)"
        />
        <SanteBotao
          v-if="!confirmandoEncerrar"
          :rotulo="t('operadoraAutorizacao.auditores.revisar')"
          :desabilitado="!podeEncerrar"
          data-testid="aut-enc-revisar"
          @acionar="confirmandoEncerrar = true"
        />
        <SanteBotao
          v-else
          :rotulo="t('operadoraAutorizacao.auditores.encerrar', { nome: encerrando?.nome ?? '' })"
          :desabilitado="!podeEncerrar"
          data-testid="aut-enc-gravar"
          @acionar="encerrar"
        />
      </template>
    </SanteDialogo>

    <SanteDialogo
      v-model:visivel="dialogoAlterar"
      :titulo="t('operadoraAutorizacao.auditores.alterar', { nome: alterando?.nome ?? '' })"
      largura="44rem"
    >
      <form class="campos" data-testid="form-alterar-auditor" @submit.prevent>
        <SanteSelecao
          v-model="fa.categoria"
          :rotulo="t('operadoraAutorizacao.auditores.categoria')"
          :opcoes="opcoesCategoria"
          obrigatorio
          data-testid="aut-alt-categoria"
        />
        <SanteCampoTexto
          id="aut-alt-numero"
          v-model="fa.numero"
          :rotulo="t('operadoraAutorizacao.auditores.numero')"
          :max-bytes="15"
          obrigatorio
        />
        <SanteSelecao
          v-model="fa.uf"
          :rotulo="t('operadoraAutorizacao.auditores.uf')"
          :opcoes="opcoesUf"
          obrigatorio
          data-testid="aut-alt-uf"
        />
        <SanteCampoTexto
          id="aut-alt-motivo"
          v-model="fa.motivo"
          :rotulo="t('operadoraAutorizacao.auditores.motivoAlteracao')"
          :max-bytes="200"
          multilinha
          obrigatorio
        />
        <div
          v-if="confirmandoAlterar"
          class="painel-confirmacao"
          role="group"
          data-testid="aut-alt-confirmacao"
        >
          <p>
            {{
              t('operadoraAutorizacao.auditores.confirmarAlterar', {
                antes: `${alterando?.nome ?? ''} (${alterando?.conselho ?? ''} ${alterando?.numero ?? ''}/${alterando?.uf ?? ''})`,
                depois: `${fa.categoria === 'enfermeiro' ? 'COREN' : 'CRM'} ${fa.numero.trim()}/${fa.uf ?? ''}`,
              })
            }}
          </p>
        </div>
        <SanteAlerta v-if="recusa" :texto="recusa" variante="alerta" data-testid="aut-alt-recusa" />
        <MensagemErro v-if="erro" :erro="erro" />
      </form>
      <template #rodape>
        <SanteBotao
          variante="secundario"
          :rotulo="t('operadoraAutorizacao.acoes.voltar')"
          @acionar="confirmandoAlterar ? (confirmandoAlterar = false) : (alterando = null)"
        />
        <SanteBotao
          v-if="!confirmandoAlterar"
          :rotulo="t('operadoraAutorizacao.auditores.revisar')"
          :desabilitado="!alteracaoCompleta"
          data-testid="aut-alt-revisar"
          @acionar="confirmandoAlterar = true"
        />
        <SanteBotao
          v-else
          :rotulo="t('operadoraAutorizacao.auditores.confirmar')"
          :desabilitado="!alteracaoCompleta"
          data-testid="aut-alt-gravar"
          @acionar="alterar"
        />
      </template>
    </SanteDialogo>
  </section>
</template>

<style scoped src="../estilo-operadora.css"></style>
<style scoped>
.formulario {
  display: grid;
  gap: 0.75rem;
}
.painel-confirmacao {
  border: 1px solid var(--sante-borda, currentColor);
  border-radius: 0.5rem;
  padding: 0.75rem;
}
</style>
