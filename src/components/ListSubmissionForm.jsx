import React, { useState } from 'react';
import { Plus, X, Send, CheckCircle, AlertCircle } from 'lucide-react';

const LIST_TYPES = [
  'Equipment Needed',
  'Volunteer Sign-ups',
  'Event Participants',
  'Maintenance Tasks',
  'Other'
];

export default function ListSubmissionForm() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    listType: '',
    items: [''],
    notes: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState(null);

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleItemChange = (index, value) => {
    const newItems = [...formData.items];
    newItems[index] = value;
    setFormData(prev => ({ ...prev, items: newItems }));
  };

  const addItem = () => {
    setFormData(prev => ({ ...prev, items: [...prev.items, ''] }));
  };

  const removeItem = (index) => {
    if (formData.items.length > 1) {
      const newItems = formData.items.filter((_, i) => i !== index);
      setFormData(prev => ({ ...prev, items: newItems }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitStatus(null);

    try {
      // Filter out empty items
      const filteredItems = formData.items.filter(item => item.trim() !== '');

      if (filteredItems.length === 0) {
        throw new Error('Please add at least one item to your list');
      }

      const response = await fetch('/api/lists', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...formData,
          items: filteredItems
        }),
      });

      const result = await response.json();

      if (response.ok) {
        let message = 'List submitted successfully!';
        
        // Handle volunteer verification and discount code
        if (formData.listType === 'Volunteer Sign-ups') {
          if (result.verification?.verified) {
            message = `Thank you for volunteering! Your discount code is: ${result.discountCode}`;
          } else {
            message = 'List submitted successfully! Note: Your name was not found in our member database. Please contact us if you believe this is an error.';
          }
        }

        setSubmitStatus({ 
          type: 'success', 
          message,
          discountCode: result.discountCode,
          verified: result.verification?.verified
        });
        
        // Reset form
        setFormData({
          name: '',
          email: '',
          listType: '',
          items: [''],
          notes: ''
        });
      } else {
        throw new Error(result.error || 'Failed to submit list');
      }
    } catch (error) {
      setSubmitStatus({ type: 'error', message: error.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6 bg-white rounded-2xl shadow-sm border border-slate-100">
      <div className="mb-8">
        <h2 className="text-3xl font-black text-[#002147] uppercase tracking-tighter mb-2">
          Submit a List
        </h2>
        <p className="text-slate-500 text-sm">
          Add items to our shared Google Sheet for equipment, volunteers, or other lists.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Info */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-bold text-[#002147] uppercase tracking-widest mb-2">
              Your Name *
            </label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => handleInputChange('name', e.target.value)}
              className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:border-[#002147] transition-colors"
              placeholder="John Doe"
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-[#002147] uppercase tracking-widest mb-2">
              Email Address *
            </label>
            <input
              type="email"
              required
              value={formData.email}
              onChange={(e) => handleInputChange('email', e.target.value)}
              className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:border-[#002147] transition-colors"
              placeholder="john@example.com"
            />
          </div>
        </div>

        {/* List Type */}
        <div>
          <label className="block text-sm font-bold text-[#002147] uppercase tracking-widest mb-2">
            List Type *
          </label>
          <select
            required
            value={formData.listType}
            onChange={(e) => handleInputChange('listType', e.target.value)}
            className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:border-[#002147] transition-colors bg-white"
          >
            <option value="">Select a list type...</option>
            {LIST_TYPES.map(type => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </div>

        {/* List Items */}
        <div>
          <label className="block text-sm font-bold text-[#002147] uppercase tracking-widest mb-2">
            List Items *
          </label>
          <div className="space-y-3">
            {formData.items.map((item, index) => (
              <div key={index} className="flex gap-2">
                <input
                  type="text"
                  value={item}
                  onChange={(e) => handleItemChange(index, e.target.value)}
                  className="flex-1 px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:border-[#002147] transition-colors"
                  placeholder={`Item ${index + 1}`}
                />
                {formData.items.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeItem(index)}
                    className="p-3 text-slate-400 hover:text-red-500 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addItem}
            className="mt-3 flex items-center gap-2 px-4 py-2 text-sm font-bold text-[#002147] uppercase tracking-widest hover:bg-slate-50 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Another Item
          </button>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-sm font-bold text-[#002147] uppercase tracking-widest mb-2">
            Additional Notes
          </label>
          <textarea
            value={formData.notes}
            onChange={(e) => handleInputChange('notes', e.target.value)}
            rows={3}
            className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:border-[#002147] transition-colors resize-none"
            placeholder="Any additional information..."
          />
        </div>

        {/* Submit Status */}
        {submitStatus && (
          <div className={`p-4 rounded-xl ${
            submitStatus.type === 'success'
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}>
            <div className="flex items-start gap-3">
              {submitStatus.type === 'success' ? (
                <CheckCircle className="w-5 h-5 mt-0.5" />
              ) : (
                <AlertCircle className="w-5 h-5 mt-0.5" />
              )}
              <div className="flex-1">
                <p className="font-medium mb-2">{submitStatus.message}</p>
                {submitStatus.discountCode && (
                  <div className="bg-white p-3 rounded-lg border-2 border-dashed border-emerald-300">
                    <p className="text-sm text-emerald-800 font-bold uppercase tracking-widest mb-1">
                      Your Discount Code
                    </p>
                    <p className="text-2xl font-black text-[#002147] tracking-wider">
                      {submitStatus.discountCode}
                    </p>
                    <p className="text-xs text-emerald-600 mt-1">
                      Use this code at checkout for 25% off your next purchase
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full bg-[#002147] text-white py-4 rounded-xl font-black uppercase tracking-widest text-sm flex items-center justify-center gap-3 hover:bg-sky-900 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Submitting...
            </>
          ) : (
            <>
              <Send className="w-4 h-4" />
              Submit List
            </>
          )}
        </button>
      </form>
    </div>
  );
}