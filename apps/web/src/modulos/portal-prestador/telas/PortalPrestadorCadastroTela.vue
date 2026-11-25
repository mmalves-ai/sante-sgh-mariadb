<script setup lang="ts">
// C2-074 (08-SGO L113, F7): "Meu cadastro e avisos" no portal do prestador credenciado (`/prestador/cadastro`). Numa
// tela só: os avisos da operadora que valem para ele (destaque primeiro), os documentos exigidos pelo tipo de
// credenciamento, o pedido de alteração do próprio cadastro (validação na hora, painel de confirmação; o cadastro só
// muda quando a operadora aprova) e os pedidos dele com a situação, o motivo da recusa e o cancelamento do não decidido.
// O documento (CPF ou CNPJ) e quem é o prestador saem da sessão, no servidor.
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import {
  type AvisoDoPortal,
  avisosPortalPrestador,
  cancelarPedidoCadastroPortal,
  type DocumentoExigido,
  documentosExigidosPortal,
  enviarPedidoCadastroPortal,
  type PedidoDoPortal,
  pedidosCadastroPortal,
  type TipoPedidoPortal,
} from '../api-cadastro-portal.js';
import PortalPrestadorCasca from '../componentes/PortalPrestadorCasca.vue';

const { t } = useI18n();
const T = (k: string, p?: Record<string, unknown>) => t(`portalPrestador.cadastro.${k}`, p ?? {});
const avisos = ref<AvisoDoPortal[]>([]);
const documentos = ref<DocumentoExigido[]>([]);
const pedidos = ref<PedidoDoPortal[]>([]);
const mensagem = ref<string | null>(null);
const recusa = ref<string | null>(null);
const erro = ref<unknown>(null);
const confirmando = ref(false);
const ocupado = ref(false);
const TIPOS: readonly TipoPedidoPortal[] = [
  'alteracao_cadastral',
  'endereco',
  'especialidade',
  'qualificacao',
];
const novo = reactive({
  tipo: 'endereco' as TipoPedidoPortal,
  nome: '',
  email: '',
  telefone: '',
  cep: '',
  cnes: '',
  oQueMuda: '',
});
const opcoesTipo = computed(() => TIPOS.map((x) => ({ valor: x, rotulo: T(`tipos.${x}`) })));
const data = (d: string) => d.slice(0, 10).split('-').reverse().join('/');

// Validação na hora (as mesmas regras do domínio, que o servidor confere de novo).
const problemas = computed(() => {
  const p: string[] = [];
  if (!novo.nome.trim()) p.push('nome-obrigatorio');
  if (novo.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(novo.email.trim())) p.push('email-invalido');
  if (novo.cep.trim() && !/^\d{8}$/.test(novo.cep.replace(/\D/g, ''))) p.push('cep-invalido');
  if (novo.cnes.trim() && !/^\d{7}$/.test(novo.cnes.trim())) p.push('cnes-invalido');
  if (novo.tipo !== 'alteracao_cadastral' && !novo.oQueMuda.trim()) p.push('detalhes-obrigatorios');
  return p;
});

function falhou(e: unknown): void {
  if (e instanceof ErroApi && e.problema?.detail && [400, 403, 404, 409].includes(e.status))
    recusa.value = e.problema.detail;
  else erro.value = e;
}

async function carregar(): Promise<void> {
  try {
    [avisos.value, documentos.value, pedidos.value] = await Promise.all([
      avisosPortalPrestador(),
      documentosExigidosPortal(),
      pedidosCadastroPortal(),
    ]);
  } catch (e) {
    falhou(e);
  }
}
onMounted(carregar);

async function enviar(): Promise<void> {
  confirmando.value = false;
  ocupado.value = true;
  mensagem.value = recusa.value = erro.value = null;
  const vazio = (v: string) => v.trim() || null;
  try {
    const r = await enviarPedidoCadastroPortal({
      tipo: novo.tipo,
      nome: novo.nome.trim(),
      email: vazio(novo.email),
      telefone: vazio(novo.telefone),
      cep: vazio(novo.cep.replace(/\D/g, '')),
      cnes: vazio(novo.cnes),
      cpf: null,
      cnpj: null,
      detalhes: novo.oQueMuda.trim() ? { [novo.tipo]: novo.oQueMuda.trim() } : null,
    });
    Object.assign(novo, { nome: '', email: '', telefone: '', cep: '', cnes: '', oQueMuda: '' });
    pedidos.value = await pedidosCadastroPortal();
    mensagem.value = r.mensagem;
  } catch (e) {
    falhou(e);
  } finally {
    ocupado.value = false;
  }
}

async function cancelar(p: PedidoDoPortal): Promise<void> {
  mensagem.value = recusa.value = erro.value = null;
  try {
    await cancelarPedidoCadastroPortal(p.id, p.versao);
    pedidos.value = await pedidosCadastroPortal();
    mensagem.value = T('cancelado', { numero: p.numero });
  } catch (e) {
    falhou(e);
  }
}
</script>

<template>
  <PortalPrestadorCasca :titulo="T('titulo')">
    <section class="conteudo" data-testid="portal-prestador-cadastro">
      <SanteAlerta v-if="mensagem" :texto="mensagem" variante="info" data-testid="pp-cad-mensagem" />
      <SanteAlerta v-if="recusa" :texto="recusa" variante="aviso" data-testid="pp-cad-recusa" />
      <MensagemErro v-if="erro" :erro="erro" />

      <h2>{{ T('avisos') }}</h2>
      <p v-if="!avisos.length">{{ T('semAvisos') }}</p>
      <ul class="lista" data-testid="pp-avisos">
        <li v-for="a in avisos" :key="a.id" :class="{ destaque: a.destaque }">
          <strong>{{ a.titulo }}</strong>
          <span v-if="a.destaque" class="selo">{{ T('destaque') }}</span>
          <small> · {{ data(a.exibirDe) }}</small>
          <p>{{ a.conteudo }}</p>
          <a v-if="a.link" :href="a.link" target="_blank" rel="noopener noreferrer">{{ T('abrirLink') }}</a>
        </li>
      </ul>

      <h2>{{ T('documentos') }}</h2>
      <p v-if="!documentos.length">{{ T('semDocumentos') }}</p>
      <ul class="lista" data-testid="pp-documentos">
        <li v-for="d in documentos" :key="d.id">
          <strong>{{ d.descricao }}</strong> · {{ d.obrigatorio ? T('obrigatorio') : T('opcional') }}
          <small v-if="d.extensoes"> · {{ T('aceita', { extensoes: d.extensoes }) }}</small>
          <small v-if="d.tamanhoMaximoKb"> {{ T('ate', { kb: d.tamanhoMaximoKb }) }}</small>
        </li>
      </ul>

      <h2>{{ T('pedir') }}</h2>
      <form class="campos" data-testid="pp-cad-form" @submit.prevent="confirmando = true">
        <SanteSelecao
          v-model="novo.tipo"
          :rotulo="T('tipo')"
          :opcoes="opcoesTipo"
          data-testid="pp-cad-tipo"
        />
        <SanteCampoTexto id="pp-cad-nome" v-model="novo.nome" :rotulo="T('nome')" :max-bytes="150" />
        <SanteCampoTexto id="pp-cad-email" v-model="novo.email" :rotulo="T('email')" :max-bytes="254" />
        <SanteCampoTexto
          id="pp-cad-telefone"
          v-model="novo.telefone"
          :rotulo="T('telefone')"
          :max-bytes="20"
        />
        <SanteCampoTexto id="pp-cad-cep" v-model="novo.cep" :rotulo="T('cep')" :max-bytes="9" />
        <SanteCampoTexto id="pp-cad-cnes" v-model="novo.cnes" :rotulo="T('cnes')" :max-bytes="7" />
        <SanteCampoTexto
          id="pp-cad-muda"
          v-model="novo.oQueMuda"
          :rotulo="T('oQueMuda')"
          :max-bytes="2000"
          multilinha
        />
        <ul v-if="problemas.length" class="problemas" data-testid="pp-cad-problemas">
          <li v-for="p in problemas" :key="p">{{ T(`problemas.${p}`) }}</li>
        </ul>
        <SanteBotao
          tipo="submit"
          :rotulo="T('enviar')"
          :desabilitado="problemas.length > 0 || ocupado"
          data-testid="pp-cad-enviar"
        />
      </form>
      <div v-if="confirmando" class="confirmacao" data-testid="pp-cad-confirmacao">
        <p>{{ T('conferir') }}</p>
        <SanteBotao :rotulo="T('confirmar')" data-testid="pp-cad-confirmar" @click="enviar" />
        <SanteBotao :rotulo="T('voltar')" variante="secundario" @click="confirmando = false" />
      </div>

      <h2>{{ T('meusPedidos') }}</h2>
      <p v-if="!pedidos.length">{{ T('semPedidos') }}</p>
      <ul class="lista" data-testid="pp-cad-pedidos">
        <li v-for="p in pedidos" :key="p.id" :data-numero="p.numero">
          <strong>{{ p.numero }}</strong> · {{ T(`tipos.${p.tipo}`) }} · {{ data(p.recebidoEm) }} ·
          <span class="situacao">{{ T(`situacoes.${p.situacao}`) }}</span>
          <p v-if="p.motivoRecusa">{{ T('motivo', { motivo: p.motivoRecusa }) }}</p>
          <SanteBotao
            v-if="p.situacao === 'recebido' || p.situacao === 'em_analise'"
            :rotulo="T('cancelar')"
            variante="secundario"
            :data-testid="`pp-cad-cancelar-${p.id}`"
            @click="cancelar(p)"
          />
        </li>
      </ul>
    </section>
  </PortalPrestadorCasca>
</template>

<style scoped src="../../operadora/estilo-operadora.css"></style>
<style scoped>
.conteudo {
  display: grid;
  gap: 1rem;
}
.campos {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
  gap: 0.5rem 1rem;
  align-items: end;
}
.lista {
  display: grid;
  gap: 0.5rem;
  padding: 0;
  list-style: none;
}
.lista li.destaque {
  border-left: 3px solid currentColor;
  padding-left: 0.5rem;
}
.selo {
  margin-left: 0.5rem;
  font-size: 0.8rem;
}
.problemas {
  grid-column: 1 / -1;
  font-weight: 600;
}
</style>
